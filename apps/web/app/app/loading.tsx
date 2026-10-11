export default function ApplicationLoading() {
  return <main className="home-dashboard home-dashboard-loading" aria-label="Loading Home dashboard" aria-busy="true">
    <div className="home-main-column" aria-hidden="true">
      <div className="home-skeleton home-loading-welcome" />
      <div className="home-skeleton home-loading-status" />
      <div className="home-skeleton home-loading-activity" />
      <div className="home-loading-cards">{[0, 1, 2].map((item) => <div className="home-skeleton" key={item} />)}</div>
    </div>
    <div className="home-progress-panel home-skeleton" aria-hidden="true" />
  </main>;
}
