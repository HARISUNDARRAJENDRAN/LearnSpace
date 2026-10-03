import type { CategoryCurriculumAnalysis } from "../../lib/discovery/category-intelligence";

export function CategoryIntelligencePanel({ analysis }: { analysis: CategoryCurriculumAnalysis }) {
  const { paragraphs, insight, approach, startingPoint } = analysis.editorial;
  return (
    <aside className="discover-playlist-panel discover-intelligence-panel" aria-labelledby="category-intelligence-heading">
      <h2 id="category-intelligence-heading">Why this collection works</h2>
      {insight ? <p className="discover-intelligence-insight">{insight}</p> : null}
      <div className="discover-intelligence-copy">
        {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {approach ? (
        <section className="discover-intelligence-approach" aria-labelledby="category-approach-heading">
          <h3 id="category-approach-heading">How to use it</h3>
          <p>{approach}</p>
          {startingPoint ? <a href={startingPoint.url} target="_blank" rel="noreferrer">Start with {startingPoint.title}<span className="sr-only"> on YouTube (new tab)</span></a> : null}
        </section>
      ) : null}
    </aside>
  );
}
