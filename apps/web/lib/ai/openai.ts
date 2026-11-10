import type { z } from "zod";
import { RECOMMENDATION_CONFIG } from "@learnspace/shared/recommendation-config";
import { normalizeVector, validVector } from "@learnspace/shared/recommendation-model";

const model = "gpt-5-mini";

export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Tests point every OpenAI call at a local stand-in.
export function openAiBaseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
}

// One chat completion whose reply must match `jsonSchema` (OpenAI strict structured output), then `parser`.
export async function structuredCompletion<T>(input: { name: string; system: string; user: string; jsonSchema: Record<string, unknown>; parser: z.ZodType<T> }): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch(`${openAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning_effort: "low",
      messages: [{ role: "system", content: input.system }, { role: "user", content: input.user }],
      response_format: { type: "json_schema", json_schema: { name: input.name, strict: true, schema: input.jsonSchema } },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return input.parser.parse(JSON.parse(content));
}

/** One query embedding with the model the worker uses for transcript chunks; null when unavailable, so retrieval stays lexical. */
export async function embedText(text: string, signal?: AbortSignal): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(`${openAiBaseUrl()}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: RECOMMENDATION_CONFIG.embeddingModel, dimensions: RECOMMENDATION_CONFIG.embeddingDimensions, input: text.slice(0, 4_000) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const vector = body.data?.[0]?.embedding;
    return validVector(vector) ? normalizeVector(vector) : null;
  } catch {
    return null;
  }
}
