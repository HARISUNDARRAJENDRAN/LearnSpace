import { z } from "zod";

export const searchModeSchema = z.enum(["learn", "research"]);
export const searchQuerySchema = z.object({
  mode: searchModeSchema,
  q: z.string().trim().max(120).default(""),
});

export type SearchMode = z.infer<typeof searchModeSchema>;

export function isSearchResultAllowed(mode: SearchMode, result: { kind: string; resourceType: string | null }): boolean {
  if (result.kind === "resource" || result.kind === "session" || result.kind === "library") {
    return result.resourceType === (mode === "learn" ? "video" : "paper");
  }
  if (result.resourceType !== null) return false;
  return mode === "learn"
    ? result.kind === "collection" || result.kind === "lesson" || result.kind === "concept"
    : result.kind === "author" || result.kind === "concept";
}
