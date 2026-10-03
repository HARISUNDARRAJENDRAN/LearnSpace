import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CategoryIntelligencePanel } from "../components/discovery/CategoryIntelligencePanel";
import { analyzeCategoryCurriculum, categoryIntelligenceFingerprint, getCategoryIntelligence } from "../lib/discovery/category-intelligence";
import { categoryEditorial } from "../lib/discovery/category-editorial";
import { getCurriculum, getCurriculumCategoryBySlug, type CurriculumCategory, type CurriculumItem } from "../lib/discovery/curriculum";
import persisted from "../lib/discovery/generated/category-intelligence.json";

async function category(slug: string): Promise<CurriculumCategory> {
  const resolved = await getCurriculumCategoryBySlug(slug);
  assert.ok(resolved);
  return resolved.category;
}

function resource(id: string, overrides: Partial<CurriculumItem> = {}): CurriculumItem {
  return { id, title: `Resource ${id}`, channel: null, url: `https://example.test/${id}`, resourceType: "playlist", curriculumRole: null, learningStage: null, track: null, coverageNotes: null, thumbnailUrl: null, thumbnailFallbackUrl: null, ...overrides };
}

test("every real category has distinct persisted editorial reasoning grounded in its actual resources", async () => {
  const categories = (await getCurriculum()).flatMap((area) => area.categories).filter((entry) => entry.items.some((item) => item.url));
  assert.equal(categories.length, Object.keys(categoryEditorial).length);
  const summaries = new Set<string>();
  for (const entry of categories) {
    const analysis = analyzeCategoryCurriculum(entry);
    assert.deepEqual(getCategoryIntelligence(entry), analysis, entry.slug);
    assert.deepEqual((persisted as Record<string, unknown>)[entry.slug], analysis, `${entry.slug}: regenerate derived metadata`);
    assert.ok(analysis.observations.length >= 5, entry.slug);
    assert.equal(analysis.resourceRoles.length, entry.items.filter((item) => item.url).length, entry.slug);
    const text = [...analysis.editorial.paragraphs, analysis.editorial.insight, analysis.editorial.approach].filter(Boolean).join(" ");
    assert.ok(text.split(/\s+/).length >= 120 && text.split(/\s+/).length <= 250, `${entry.slug}: keep copy compact`);
    assert.doesNotMatch(text, /dive into|unlock your potential|embark on|master the world|carefully curated|highly viewed|excellent mathematical depth/i);
    assert.ok(!summaries.has(text), entry.slug);
    summaries.add(text);
    for (const observation of analysis.observations) {
      assert.ok(observation.evidence.length, `${entry.slug}: no unsupported claim`);
      for (const evidence of observation.evidence) {
        assert.ok(entry.items.some((item) => item.url === evidence.resourceUrl && item[evidence.field] === evidence.value), `${entry.slug}: source evidence must resolve`);
      }
    }
  }
});

test("removing an anchor removes its rationale and starting-point advice", async () => {
  const original = await category("coding-programming");
  const changed = { ...original, items: original.items.filter((item) => !item.title.includes("Harvard CS50")) };
  const analysis = getCategoryIntelligence(changed);
  assert.notEqual(analysis.fingerprint, getCategoryIntelligence(original).fingerprint);
  assert.doesNotMatch(JSON.stringify(analysis.editorial), /CS50/);
  assert.equal(analysis.editorial.startingPoint, null);
});

test("changing coverage or creator evidence invalidates the specific claim", async () => {
  const original = await category("coding-programming");
  const withoutCoverage = { ...original, items: original.items.map((item) => item.title.includes("Harvard CS50") ? { ...item, coverageNotes: null } : item) };
  assert.doesNotMatch(analyzeCategoryCurriculum(withoutCoverage).editorial.paragraphs.join(" "), /CS50 supplies/);
  const replacedCreator = { ...original, items: original.items.map((item) => item.channel === "Programming with Mosh" ? { ...item, channel: "Different creator" } : item) };
  assert.doesNotMatch(analyzeCategoryCurriculum(replacedCreator).editorial.paragraphs.join(" "), /Mosh/);
});

test("overlap requires distinct resources, not merely a surviving topic label", async () => {
  const original = await category("design");
  let keptFigma = false;
  const changed = { ...original, items: original.items.filter((item) => {
    if (item.track !== "Figma") return true;
    if (keptFigma) return false;
    keptFigma = true;
    return true;
  }) };
  assert.equal(analyzeCategoryCurriculum(changed).intentionalOverlap.length, 0);
  assert.doesNotMatch(analyzeCategoryCurriculum(changed).editorial.paragraphs.join(" "), /several Figma/);
});

test("adding a coverage gap's missing topic withdraws the gap and includes the new branch", async () => {
  const original = await category("design");
  const before = analyzeCategoryCurriculum(original);
  assert.equal(before.coverageGaps.length, 1);
  const changed = { ...original, items: [...original.items, resource("research", { title: "User Research and Usability Testing", track: "User research", learningStage: "Core" })] };
  const after = analyzeCategoryCurriculum(changed);
  assert.equal(after.coverageGaps.length, 0);
  assert.match(after.editorial.paragraphs.join(" "), /user research/);
  assert.doesNotMatch(after.editorial.paragraphs.join(" "), /no dedicated user-research/);
  assert.notEqual(before.fingerprint, after.fingerprint);
});

test("empty, single-resource, and sparse collections never invent a curriculum", () => {
  const empty: CurriculumCategory = { slug: "new-category", name: "A new category", items: [] };
  assert.match(analyzeCategoryCurriculum(empty).editorial.paragraphs.join(" "), /no available lessons/);
  const single = analyzeCategoryCurriculum({ ...empty, items: [resource("one", { title: "Measuring sound", track: "Acoustics", coverageNotes: "An introduction to sound measurement." })] });
  assert.equal(single.curriculumType, "exploratory");
  assert.match(single.editorial.paragraphs.join(" "), /Measuring sound|sound measurement/);
  assert.doesNotMatch(single.editorial.paragraphs.join(" "), /beginner to advanced|two|complement/);
  const sparse = analyzeCategoryCurriculum({ ...empty, items: [resource("one"), resource("two")] });
  assert.match(sparse.editorial.paragraphs.join(" "), /not enough topic or coverage information/);
  assert.equal(sparse.editorial.approach, null);
  const pair = analyzeCategoryCurriculum({ ...empty, items: [resource("one", { track: "Acoustics" }), resource("two", { track: "Acoustics" })] });
  assert.match(pair.editorial.paragraphs.join(" "), /shared topic alone does not establish that both are necessary/);
});

test("fingerprints track curriculum changes while ignoring thumbnails and CSV row identities", async () => {
  const original = await category("physics");
  const signature = categoryIntelligenceFingerprint(original);
  const visualChanges = { ...original, items: original.items.map((item) => ({ ...item, id: `new-${item.id}`, thumbnailUrl: "https://example.test/image.jpg" })) };
  assert.equal(categoryIntelligenceFingerprint(visualChanges), signature);
  for (const update of [{ title: "New course" }, { channel: "New creator" }, { track: "New topic" }, { learningStage: "Applied" }, { curriculumRole: "Supplemental" }, { coverageNotes: "Changed scope" }, { publishedOrUpdated: "2026-10-02" }, { language: "fr" }, { url: "https://example.test/replacement" }, { resourceType: "video" }]) {
    const changed = { ...original, items: original.items.map((item, index) => index === 0 ? { ...item, ...update } : item) };
    assert.notEqual(categoryIntelligenceFingerprint(changed), signature, JSON.stringify(update));
  }
  assert.notEqual(categoryIntelligenceFingerprint({ ...original, items: original.items.toReversed() }), signature);
});

test("cached intelligence is stable and meaningful edits replace its snapshot", async () => {
  const original = await category("physics");
  const first = getCategoryIntelligence(original);
  assert.equal(getCategoryIntelligence(original), first);
  const changed = { ...original, items: original.items.filter((item) => item.track !== "Quantum mechanics") };
  const next = getCategoryIntelligence(changed);
  assert.notEqual(next, first);
  assert.equal(getCategoryIntelligence(changed), next);
  assert.doesNotMatch(next.editorial.paragraphs.join(" "), /quantum mechanics/);
  assert.deepEqual(getCategoryIntelligence(original), first);
});

test("exploratory categories do not acquire an invented prerequisite ladder", async () => {
  for (const slug of ["certifications", "language-learning", "mental-wellness", "tech-news"]) {
    const analysis = analyzeCategoryCurriculum(await category(slug));
    assert.equal(analysis.curriculumType, "exploratory");
    assert.doesNotMatch(analysis.editorial.paragraphs.join(" "), /must complete|prerequisite for|guarantees/);
  }
});

test("the panel presents editorial context while keeping internal evidence and analytics out of the UI", async () => {
  const actual = await category("coding-programming");
  const analysis = getCategoryIntelligence(actual);
  const panel = <CategoryIntelligencePanel analysis={analysis} />;
  const html = renderToStaticMarkup(panel);
  assert.match(html, /Why this collection works|How to use it|CS50 supplies/);
  assert.match(html, /aria-labelledby="category-intelligence-heading"/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /discover-panel-level-chart|discover-panel-donut|Resource mix|Learning levels|AI Summary|confidence|fingerprint|recommendation score/);
  const unsafe = analyzeCategoryCurriculum({ slug: "new-category", name: "New", items: [resource("one", { title: "<script>alert(1)</script>" })] });
  const escaped = renderToStaticMarkup(<CategoryIntelligencePanel analysis={unsafe} />);
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});
