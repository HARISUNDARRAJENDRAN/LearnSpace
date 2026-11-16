import { PassThrough } from "node:stream";
import Docker from "dockerode";
import type { ExecuteResponse } from "./protocol.js";
import type { executeRequestSchema } from "./protocol.js";
import type { z } from "zod";

type Envelope = z.output<typeof executeRequestSchema>;

const LABEL = "learnspace.sandbox";
const ENVELOPE_MARKER = "\n--learnspace-envelope--\n";
// Startup, file writes and the report around the program's own limits.
const OVERHEAD_MS = 15_000;
const REPORT_LIMIT = 48 << 20;

export class SandboxError extends Error {}

export type SandboxConfig = {
  image: string;
  /** An OCI runtime such as gVisor's runsc; Docker's default when unset. */
  runtime?: string | undefined;
  cpus: number;
};

/** Starts one fresh container per execution: no network, a read-only root, capped memory, CPU and processes. */
export function createSandbox(docker: Docker, config: SandboxConfig) {
  async function execute(envelope: Envelope): Promise<ExecuteResponse> {
    const memoryBytes = (envelope.memoryMb + 64) * 1024 * 1024;
    const container = await docker.createContainer({
      Image: config.image,
      OpenStdin: true,
      StdinOnce: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      NetworkDisabled: true,
      Labels: { [LABEL]: "1" },
      HostConfig: {
        NetworkMode: "none",
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,exec,nosuid,nodev,size=128m,mode=1777" },
        Memory: memoryBytes,
        MemorySwap: memoryBytes,
        NanoCpus: Math.round(config.cpus * 1e9),
        PidsLimit: 128,
        // The entrypoint drops every program to nobody and kills it at its deadline; nothing else is allowed.
        CapDrop: ["ALL"],
        CapAdd: ["SETUID", "SETGID", "KILL"],
        SecurityOpt: ["no-new-privileges"],
        Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }],
        ...(config.runtime ? { Runtime: config.runtime } : {}),
      },
    });
    const deadline = OVERHEAD_MS + envelope.compileTimeoutMs + envelope.runs.reduce((sum, run) => sum + run.timeoutMs, 0);
    try {
      const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true, hijack: true });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      container.modem.demuxStream(stream, stdout, stderr);
      const chunks: Buffer[] = [];
      let size = 0;
      stdout.on("data", (chunk: Buffer) => { if (size < REPORT_LIMIT) { chunks.push(chunk); size += chunk.length; } });
      let errors = "";
      stderr.on("data", (chunk: Buffer) => { if (errors.length < 8_192) errors += chunk.toString("utf8"); });
      const ended = new Promise<void>((resolve) => { stream.on("end", resolve); stream.on("close", resolve); });
      await container.start();
      // Framed: the Docker client can put its attach request's own body on stdin ahead of what is written here.
      stream.end(`${ENVELOPE_MARKER}${JSON.stringify(envelope)}`);
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), deadline); });
      const outcome = await Promise.race([container.wait().then(() => "done" as const), timedOut]);
      clearTimeout(timer);
      if (outcome === "timeout") throw new SandboxError("sandbox exceeded its deadline");
      await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 2_000))]);
      const text = Buffer.concat(chunks).toString("utf8").trim();
      try {
        return JSON.parse(text) as ExecuteResponse;
      } catch {
        throw new SandboxError(`sandbox gave no report: ${errors.slice(0, 500)}`);
      }
    } finally {
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  /** Removes containers a previous process left behind (a crash mid-execution). */
  async function sweep(): Promise<void> {
    const leftovers = await docker.listContainers({ all: true, filters: { label: [LABEL] } });
    await Promise.all(leftovers.map((item) => docker.getContainer(item.Id).remove({ force: true }).catch(() => undefined)));
  }

  return { execute, sweep };
}
