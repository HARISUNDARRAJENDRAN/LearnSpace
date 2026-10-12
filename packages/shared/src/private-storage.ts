import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketLocationCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { z } from "zod";

export const MAX_PRIVATE_DOCUMENT_BYTES = 25 * 1024 * 1024;

const storageSettings = z.object({
  S3_BUCKET: z.string().min(3),
  S3_REGION: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  AWS_ROLE_ARN: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().url().optional(),
});

let storage: { client: S3Client; bucket: string } | undefined;

function getStorage() {
  if (storage) return storage;
  const settings = storageSettings.parse(process.env);
  const onHostedVercel = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
  const region = settings.S3_REGION ?? (onHostedVercel ? undefined : settings.AWS_REGION);
  if (!region) {
    throw new Error(onHostedVercel
      ? "S3_REGION is required for hosted Vercel storage access"
      : "S3_REGION or AWS_REGION is required");
  }
  if (onHostedVercel && !settings.AWS_ROLE_ARN) throw new Error("AWS_ROLE_ARN is required for hosted Vercel storage access");
  if (settings.S3_ENDPOINT && process.env.NODE_ENV === "production" && !settings.S3_ENDPOINT.startsWith("https://")) {
    throw new Error("S3_ENDPOINT must use HTTPS in production");
  }
  storage = {
    bucket: settings.S3_BUCKET,
    client: new S3Client({
      region,
      ...(onHostedVercel ? { credentials: awsCredentialsProvider({ roleArn: settings.AWS_ROLE_ARN! }) } : {}),
      ...(settings.S3_ENDPOINT ? { endpoint: settings.S3_ENDPOINT, forcePathStyle: true } : {}),
    }),
  };
  return storage;
}

export async function privateStorageReady(): Promise<boolean> {
  try {
    const { client, bucket } = getStorage();
    await client.send(new GetBucketLocationCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(3_000),
    });
    return true;
  } catch {
    return false;
  }
}

export function pendingDocumentKey(userId: string, resourceId: string, versionId: string, nonce: string) {
  return `pending/${userId}/${resourceId}/${versionId}/${nonce}.pdf`;
}

export function privateDocumentKey(userId: string, resourceId: string, versionId: string) {
  return `private/${userId}/${resourceId}/${versionId}/source.pdf`;
}

export async function signPrivateUpload(key: string, byteSize: number) {
  const { client, bucket } = getStorage();
  const headers = { "Content-Type": "application/pdf", "If-None-Match": "*" };
  const url = await getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/pdf",
    ContentLength: byteSize,
    IfNoneMatch: "*",
  }), {
    expiresIn: 300,
    signableHeaders: new Set(["content-length", "content-type", "if-none-match"]),
  });
  return { url, headers };
}

export async function headPrivateObject(key: string) {
  const { client, bucket } = getStorage();
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
}

export async function signPrivateDownload(key: string) {
  const { client, bucket } = getStorage();
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: "application/pdf",
    ResponseContentDisposition: 'inline; filename="LearnSpace-document.pdf"',
    ResponseCacheControl: "private, no-store",
  }), { expiresIn: 120 });
}

export async function readPrivateObject(key: string, maxBytes: number) {
  const { client, bucket } = getStorage();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (response.ContentLength === undefined || response.ContentLength > maxBytes) {
    if (response.Body && "destroy" in response.Body && typeof response.Body.destroy === "function") response.Body.destroy();
    throw new Error("Stored document exceeds the supported size");
  }
  if (!response.Body) throw new Error("Stored document is empty");
  const bytes = await response.Body.transformToByteArray();
  if (bytes.byteLength !== response.ContentLength) throw new Error("Stored document size did not match metadata");
  return { bytes, contentType: response.ContentType ?? "" };
}

export async function putPrivateObject(key: string, bytes: Uint8Array, sha256: string) {
  const { client, bucket } = getStorage();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: "application/pdf",
    ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
  }));
}

export async function deletePrivateObject(key: string) {
  const { client, bucket } = getStorage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
