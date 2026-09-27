export default function DiscoverLoading() {
  return (
    <main className="discovery-canvas discovery-curriculum discover-home discover-home-loading" aria-busy="true" aria-label="Loading Discover">
      <section className="discover-loading-section">
        <div className="discover-skeleton-heading" />
        <div className="discover-category-grid">
          {[1, 2, 3].map((card) => <div className="discover-category-skeleton" key={card} />)}
        </div>
      </section>
      {[1, 2, 3, 4, 5, 6, 7].map((section) => (
        <section className="discover-loading-section" key={section}>
          <div className="discover-skeleton-heading" />
          <div className="discover-category-grid">
            {[1, 2, 3].map((card) => <div className="discover-category-skeleton" key={card} />)}
          </div>
        </section>
      ))}
    </main>
  );
}
