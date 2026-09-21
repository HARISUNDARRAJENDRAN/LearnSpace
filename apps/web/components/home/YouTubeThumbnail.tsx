"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";

type YouTubeThumbnailProps = Omit<ImageProps, "src"> & {
  src: string;
  fallbackSrc?: string | null;
};

export type ThumbnailState = "primary" | "fallback" | "placeholder";

export function thumbnailStateAfterError(state: ThumbnailState, src: string, fallbackSrc: string | null | undefined): ThumbnailState {
  return state === "primary" && fallbackSrc && fallbackSrc !== src ? "fallback" : "placeholder";
}

export function YouTubeThumbnail({ src, fallbackSrc, ...props }: YouTubeThumbnailProps) {
  const [selection, setSelection] = useState<{ src: string; state: ThumbnailState }>({
    src,
    state: src ? "primary" : "placeholder",
  });
  const { alt, className, ...imageProps } = props;

  useEffect(() => {
    setSelection({ src, state: src ? "primary" : "placeholder" });
  }, [src]);

  // Derive the new primary during render so a preserved component cannot paint the previous source for a frame.
  const state = selection.src === src ? selection.state : src ? "primary" : "placeholder";
  const currentSrc = state === "primary" ? src : state === "fallback" ? fallbackSrc : null;
  if (!currentSrc) {
    const placeholder = <img src="/assets/learnspace-monogram.svg" alt="" aria-hidden="true" />;
    const placeholderClass = ["home-media-placeholder", "home-thumbnail-placeholder", className].filter(Boolean).join(" ");
    return alt
      ? <span className={placeholderClass} role="img" aria-label={alt}>{placeholder}</span>
      : <span className={placeholderClass} aria-hidden="true">{placeholder}</span>;
  }

  return (
    <Image
      key={currentSrc}
      {...imageProps}
      alt={alt}
      src={currentSrc}
      unoptimized
      quality={100}
      onError={() => {
        setSelection((previous) => ({
          src,
          state: thumbnailStateAfterError(previous.src === src ? previous.state : "primary", src, fallbackSrc),
        }));
      }}
    />
  );
}
