export default function ApplicationLoading() {
  return <main className="discovery-page discovery-loading" aria-busy="true"><div className="discovery-skeleton discovery-skeleton-title" /><div className="discovery-skeleton-grid">{["one", "two", "three", "four"].map((key) => <div className="discovery-skeleton" key={key} />)}</div></main>;
}
