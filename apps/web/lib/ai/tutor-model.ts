import { openAiBaseUrl } from "./openai";
// The study tutor's model, separate from the cheap gpt-5-mini helper the discovery and plan agents use.
export const TUTOR_MODEL = {
  provider: "openai",
  id: "gpt-6-luna",
  // Every turn is first asked without reasoning, so a direct answer streams within about a second. The model's first
  // output says whether the question needs working through; if so the turn is asked again with reasoning.
  // quick: the visible answer is a few hundred tokens, the limit only stops a runaway; deep: most of it goes on reasoning.
  depths: { quick: { effort: "none", maxOutputTokens: 4_000 }, deep: { effort: "medium", maxOutputTokens: 16_000 } },
  timeoutMs: 110_000,
  // USD per token, from developers.openai.com/api/docs/models/gpt-6-luna (Standard tier, prompts under 272K tokens).
  // Cache writes are 1.25x input for the default 30-minute lifetime (developers.openai.com/api/docs/guides/prompt-caching).
  price: { input: 0.10 / 1e6, cachedInput: 0.01 / 1e6, cacheWrite: 0.125 / 1e6, output: 0.50 / 1e6 },
  // Fast processing (`service_tier: "fast"`) bills every rate twice over and starts answering ~0.3 s sooner.
  fastMultiplier: 2,
} as const;

/** `fast`: the call ran (and is billed) on Fast processing; a Fast request the provider downgraded is not. */
export type TutorUsage = { inputTokens: number; cachedTokens: number; cacheWriteTokens: number; outputTokens: number; reasoningTokens: number; fast: boolean };
export type TutorDepth = keyof typeof TUTOR_MODEL.depths;
export type TutorModelRequest = { depth: TutorDepth; instructions: string; developer: string; user: string; schema: Record<string, unknown>; cacheKey: string; image?: string | null; fast?: boolean };
export type TutorModelResult = { text: string; refusal: string | null; usage: TutorUsage; firstOutputMs: number | null; latencyMs: number };
export type TutorModel = (request: TutorModelRequest, hooks: { signal: AbortSignal; onFirstOutput?: () => void; onText?: (text: string) => void }) => Promise<TutorModelResult>;

export class TutorModelError extends Error {
  constructor(readonly code: string, readonly usage: TutorUsage | null = null) {
    super(code);
  }
}

/** Cached reads and cache writes are both inside input tokens, and reasoning tokens inside output tokens. */
export function estimateCostUsd(usage: TutorUsage): number {
  const { price } = TUTOR_MODEL;
  const uncached = usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens;
  const standard = uncached * price.input + usage.cachedTokens * price.cachedInput + usage.cacheWriteTokens * price.cacheWrite + usage.outputTokens * price.output;
  return usage.fast ? standard * TUTOR_MODEL.fastMultiplier : standard;
}

type ResponsesUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
type ResponsesResponse = { usage?: ResponsesUsage; service_tier?: string; incomplete_details?: { reason?: string }; error?: { code?: string } };
type ResponsesEvent = {
  type?: string;
  delta?: string;
  response?: ResponsesResponse;
  error?: { code?: string };
};

function usageOf(response: ResponsesResponse | undefined): TutorUsage {
  const usage = response?.usage;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    fast: response?.service_tier === "fast" || response?.service_tier === "priority",
  };
}

/** One streamed Responses API call with strict structured output. Never retried here: a retry is a new, separately admitted turn. */
export const openAiTutorModel: TutorModel = async (request, { signal, onFirstOutput, onText }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TutorModelError("provider_not_configured");
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${openAiBaseUrl()}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TUTOR_MODEL.id,
        reasoning: { effort: TUTOR_MODEL.depths[request.depth].effort },
        // One explicit breakpoint after the static instructions (and the schema rendered before them): every turn of every
        // learner reads that prefix, and nothing per-turn is written. Per-turn guidance follows the data so it stays outside it.
        input: [
          { role: "developer", content: [{ type: "input_text", text: request.instructions, prompt_cache_breakpoint: { mode: "explicit" } }] },
          { role: "user", content: request.image ? [{ type: "input_text", text: request.user }, { type: "input_image", image_url: request.image, detail: "high" }] : request.user },
          { role: "developer", content: request.developer },
        ],
        text: { format: { type: "json_schema", name: "tutor_turn", strict: true, schema: request.schema } },
        max_output_tokens: TUTOR_MODEL.depths[request.depth].maxOutputTokens,
        prompt_cache_key: request.cacheKey,
        prompt_cache_options: { mode: "explicit" },
        // Conversations stay in LearnSpace's database, not on the provider.
        store: false,
        stream: true,
        ...(request.fast ? { service_tier: "fast" } : {}),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TUTOR_MODEL.timeoutMs)]),
    });
  } catch (error) {
    throw new TutorModelError(signal.aborted ? "cancelled" : error instanceof Error && error.name === "TimeoutError" ? "provider_timeout" : "provider_unreachable");
  }
  if (!response.ok || !response.body) throw new TutorModelError(`provider_http_${response.status}`);
  let text = "";
  let refusal = "";
  let firstOutputMs: number | null = null;
  let buffer = "";
  const decoder = new TextDecoder();
  const handle = (event: ResponsesEvent): TutorModelResult | null => {
    if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
      if (firstOutputMs === null) { firstOutputMs = Math.round(performance.now() - started); onFirstOutput?.(); }
      if (event.type === "response.output_text.delta") {
        text += event.delta ?? "";
        onText?.(text);
      } else refusal += event.delta ?? "";
      return null;
    }
    if (event.type === "response.completed") return { text, refusal: refusal || null, usage: usageOf(event.response), firstOutputMs, latencyMs: Math.round(performance.now() - started) };
    if (event.type === "response.incomplete") throw new TutorModelError(`provider_incomplete_${event.response?.incomplete_details?.reason ?? "unknown"}`, usageOf(event.response));
    if (event.type === "response.failed") throw new TutorModelError(`provider_failed_${event.response?.error?.code ?? "unknown"}`, usageOf(event.response));
    if (event.type === "error") throw new TutorModelError(`provider_error_${event.error?.code ?? "unknown"}`);
    return null;
  };
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const result = handle(JSON.parse(data) as ResponsesEvent);
        if (result) return result;
      }
    }
  } catch (error) {
    if (error instanceof TutorModelError) throw error;
    throw new TutorModelError(signal.aborted ? "cancelled" : error instanceof Error && error.name === "TimeoutError" ? "provider_timeout" : "provider_stream_broken");
  }
  throw new TutorModelError("provider_stream_ended");
};
