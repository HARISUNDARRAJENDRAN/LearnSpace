const unavailable = "Source search was unavailable; tell the learner rather than inventing a source.";
const https = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};

/** Uses the app's existing Exa provider; only on an explicit request for sources or pictures. */
export async function notesSources(utterance: string, signal: AbortSignal): Promise<string> {
  if (!/\b(images?|pictures?|photos?|links?|sources?|references?)\b/i.test(utterance) || !/\b(find|search|look up|fetch|add|insert|include|show|get)\b/i.test(utterance)) return "";
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return unavailable;
  try {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST", redirect: "error",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      body: JSON.stringify({ query: utterance.slice(0, 500), type: "auto", numResults: 3, contents: { highlights: { maxCharacters: 800 }, extras: { imageLinks: 2 } } }),
    });
    if (!response.ok) return unavailable;
    const body = await response.json() as { results?: Array<{ title?: string; url?: string; image?: string; highlights?: string[]; extras?: { imageLinks?: string[] } }> };
    return (body.results ?? []).slice(0, 3).flatMap((result) => {
      const url = https(result.url);
      if (!url) return [];
      return [JSON.stringify({ title: result.title?.slice(0, 200), url, images: [result.image, ...(result.extras?.imageLinks ?? [])].map(https).filter(Boolean).slice(0, 3), excerpt: (result.highlights ?? []).join(" ").slice(0, 800) })];
    }).join("\n") || "No matching source was found. Ask for a more specific subject.";
  } catch { return unavailable; }
}
