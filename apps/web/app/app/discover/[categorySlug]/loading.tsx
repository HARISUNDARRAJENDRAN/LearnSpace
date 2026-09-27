export default function DiscoverCategoryLoading() {
  return (
    <main className="discovery-canvas discovery-curriculum discovery-category-page" aria-busy="true" aria-label="Loading category">
      <div className="discovery-category-loading-header">
        <div className="discovery-skeleton discovery-category-skeleton-back" />
        <div className="discovery-skeleton discovery-category-skeleton-title" />
      </div>
      <div className="home-recommendation-grid">
        {["first", "second", "third", "fourth"].map((key) => (
          <div className="discovery-category-skeleton-card" key={key}>
            <div className="discovery-skeleton discovery-category-skeleton-media" />
            <div className="discovery-skeleton discovery-category-skeleton-line" />
            <div className="discovery-skeleton discovery-category-skeleton-line discovery-category-skeleton-short" />
          </div>
        ))}
      </div>
    </main>
  );
}
