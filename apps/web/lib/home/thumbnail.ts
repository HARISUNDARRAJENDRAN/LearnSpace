const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function youtubeThumbnailSources(youtubeId: string | null | undefined): { primary: string; fallback: string } | null {
  if (!youtubeId || !youtubeIdPattern.test(youtubeId)) return null;
  return {
    primary: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    fallback: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
  };
}

export function youtubeThumbnailSourcesFromUrl(src: string | null | undefined): { primary: string; fallback: string } | null {
  const match = src?.match(/\/vi\/([A-Za-z0-9_-]{11})\/(?:maxresdefault|hqdefault)\.jpg$/);
  return youtubeThumbnailSources(match?.[1]);
}

export function youtubeThumbnailFallback(src: string | null | undefined): string | null {
  return youtubeThumbnailSourcesFromUrl(src)?.fallback ?? null;
}
