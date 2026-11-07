import type { z } from "zod";

const model = "gpt-5-mini";

export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// One chat completion whose reply must match `jsonSchema` (OpenAI strict structured output), then `parser`.
export async function structuredCompletion<T>(input: { name: string; system: string; user: string; jsonSchema: Record<string, unknown>; parser: z.ZodType<T> }): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
