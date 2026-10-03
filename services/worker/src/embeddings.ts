import { RECOMMENDATION_CONFIG as config } from "@learnspace/shared/recommendation-config";
import { normalizeVector, validVector } from "@learnspace/shared/recommendation-model";

export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

let providerPausedUntil = 0;

export function embeddingProvider(): EmbeddingProvider | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || Date.now() < providerPausedUntil) return null;
  async function embedDocuments(texts: string[]): Promise<number[][]> {
    if (Date.now() < providerPausedUntil) throw new Error("Embedding provider is cooling down");
    const started = performance.now();
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.embeddingModel, dimensions: config.embeddingDimensions, input: texts.map((text) => text.slice(0, config.embeddingInputCharacters)) }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      if ([401, 403, 429].includes(response.status)) providerPausedUntil = Date.now() + config.providerCooldownMs;
      throw new Error(`Embedding provider HTTP ${response.status}`);
    }
    const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const vectors = body.data?.slice().sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (!vectors || vectors.length !== texts.length || !vectors.every((vector) => validVector(vector))) throw new Error("Invalid embedding provider response");
    console.info(JSON.stringify({ metric: "embedding_generation_latency", ms: performance.now() - started, count: texts.length, model: config.embeddingModel }));
    return vectors.map(normalizeVector);
  }
  return { embedDocuments, async embedQuery(text) { return (await embedDocuments([text]))[0]!; } };
}

export function contentEmbeddingText(resource: { title: string; description?: string | null; topics?: string[]; transcript?: string | null }): string {
  return [resource.title, resource.description?.slice(0, 6000), resource.topics?.join(", "), resource.transcript?.slice(0, 4000)].filter(Boolean).join("\n").slice(0, config.embeddingInputCharacters);
}
