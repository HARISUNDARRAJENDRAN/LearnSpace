export default function ApplicationLoading() {
  return <main className="home-page" aria-label="Loading Home" aria-busy="true">
    <span className="home-skeleton" style={{ height: "max(480px, 70dvh)" }} />
    <div className="home-cards">
      {[0, 1, 2].map((index) => <span key={index} className="home-skeleton" style={{ height: 320 }} />)}
    </div>
  </main>;
}
