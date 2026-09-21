"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type YouTubeThumbnailProps = Omit<ImageProps, "src"> & {
  src: string;
  fallbackSrc?: string | null;
};

export function YouTubeThumbnail({ src, fallbackSrc, ...props }: YouTubeThumbnailProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [fallbackTried, setFallbackTried] = useState(false);

  return (
    <Image
      {...props}
      src={currentSrc}
      unoptimized
      quality={100}
      onError={() => {
        if (!fallbackTried && fallbackSrc && currentSrc !== fallbackSrc) {
          setFallbackTried(true);
          setCurrentSrc(fallbackSrc);
        }
      }}
    />
  );
}
