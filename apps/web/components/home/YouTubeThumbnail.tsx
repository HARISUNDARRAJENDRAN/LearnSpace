"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";
import { youtubeThumbnailSourcesFromUrl } from "../../lib/home/thumbnail";

type YouTubeThumbnailProps = Omit<ImageProps, "src"> & {
  src: string;
  fallbackSrc?: string | null;
};

export type ThumbnailState = "primary" | "fallback" | "placeholder";

export function thumbnailStateAfterError(state: ThumbnailState, src: string, fallbackSrc: string | null | undefined): ThumbnailState {
  return state === "primary" && fallbackSrc && fallbackSrc !== src ? "fallback" : "placeholder";
}

export function YouTubeThumbnail({ src, fallbackSrc, ...props }: YouTubeThumbnailProps) {
  const thumbnailSources = youtubeThumbnailSourcesFromUrl(src);
  const primarySrc = thumbnailSources?.primary ?? src;
  const resolvedFallbackSrc = fallbackSrc ?? thumbnailSources?.fallback;
  const [selection, setSelection] = useState<{ src: string; state: ThumbnailState }>({
    src: primarySrc,
    state: primarySrc ? "primary" : "placeholder",
  });
  const { alt, className, ...imageProps } = props;

  useEffect(() => {
    setSelection({ src: primarySrc, state: primarySrc ? "primary" : "placeholder" });
  }, [primarySrc]);

  // Derive the new primary during render so a preserved component cannot paint the previous source for a frame.
  const state = selection.src === primarySrc ? selection.state : primarySrc ? "primary" : "placeholder";
  const currentSrc = state === "primary" ? primarySrc : state === "fallback" ? resolvedFallbackSrc : null;
  if (!currentSrc) {
    const placeholder = <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 11 7-11 7Z" strokeLinejoin="round" /></svg>;
    const placeholderClass = ["home-media-placeholder", "home-thumbnail-placeholder", className].filter(Boolean).join(" ");
    return alt
      ? <span className={placeholderClass} style={{ display: "grid", placeItems: "center" }} role="img" aria-label={alt}>{placeholder}</span>
      : <span className={placeholderClass} style={{ display: "grid", placeItems: "center" }} aria-hidden="true">{placeholder}</span>;
  }

  return (
    <Image
      key={currentSrc}
      {...imageProps}
      alt={alt}
      className={className}
      src={currentSrc}
      unoptimized
      quality={100}
      onLoad={(event) => {
        imageProps.onLoad?.(event);
        // YouTube can return its 120px missing-image tile with HTTP 200.
        if (thumbnailSources && event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalWidth <= 120) {
          setSelection((previous) => ({ src: primarySrc, state: thumbnailStateAfterError(previous.state, primarySrc, resolvedFallbackSrc) }));
        }
      }}
      onError={() => {
        setSelection((previous) => ({
          src: primarySrc,
          state: thumbnailStateAfterError(previous.src === primarySrc ? previous.state : "primary", primarySrc, resolvedFallbackSrc),
        }));
      }}
    />
  );
}
