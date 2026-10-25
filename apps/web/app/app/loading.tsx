export default function ApplicationLoading() {
  return <main className="home-dashboard" aria-label="Loading Home" aria-busy="true">
    <div className="home-main" style={{ gap: 14 }}>
      <span className="home-skeleton" style={{ height: 64 }} />
      <span className="home-skeleton" style={{ height: 46, width: "70%" }} />
      <span className="home-skeleton" style={{ height: 48 }} />
      <span className="home-skeleton" style={{ height: 420 }} />
    </div>
    <span className="home-skeleton" style={{ height: 640, borderRadius: 26 }} />
  </main>;
}
