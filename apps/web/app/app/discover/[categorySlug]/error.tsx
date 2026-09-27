"use client";

import Link from "next/link";

type Props = { error: Error & { digest?: string }; reset: () => void };

export default function DiscoverCategoryError({ reset }: Props) {
  return (
    <main className="discovery-canvas discovery-curriculum discovery-category-page" role="alert">
      <header className="discovery-category-header">
        <Link href="/app/discover" className="discovery-category-back"><span aria-hidden="true">←</span> Discover</Link>
        <h1>We couldn’t load this category.</h1>
      </header>
      <div className="discovery-category-empty">
        <p>Please try again.</p>
        <button type="button" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
