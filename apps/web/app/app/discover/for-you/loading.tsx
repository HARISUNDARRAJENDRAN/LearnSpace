export default function ForYouLoading() {
  return <main className="discover-home discover-for-you" aria-busy="true" aria-label="Loading recommendations"><div className="discover-loading-section"><h1>Recommended for you</h1></div><div className="discovery-card-grid discovery-recommendations-full-grid">{["first", "second", "third", "fourth", "fifth", "sixth"].map((slot) => <div className="discover-recommendation-skeleton" key={slot} aria-hidden="true" />)}</div></main>;
}
