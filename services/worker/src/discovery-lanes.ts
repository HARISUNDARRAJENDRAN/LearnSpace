/**
 * Query lanes for background discovery. A lane is a search angle on one concept (keyed by concept and lane,
 * never by user), so every learner who wants that angle shares one cached search.
 */
export type DiscoveryLane = "beginner_friendly" | "practical" | "in_depth" | "recent";

export type LaneProfile = {
  persona?: string | null;
  learningIntents?: string[];
  preferredFormats?: string[];
  level?: string | null;
};

const practicalIntents = new Set(["build_project", "build_something", "prototype_idea", "reproduce_implementations", "learn_new_technology", "learn_technology", "improve_skill"]);
const deepIntents = new Set(["research", "read_papers", "follow_research_area", "literature_review", "understand_something_deeply", "read_more_deeply", "understand_how_something_works", "teaching_preparation"]);

/** At most two lanes from the learner's profile, in priority order, plus the always-on "recent" lane. */
export function discoveryLanes(profile: LaneProfile): DiscoveryLane[] {
  const formats = profile.preferredFormats ?? [];
  const intents = profile.learningIntents ?? [];
  const deep = profile.persona === "researcher" || profile.level === "advanced"
    || formats.includes("deep_dives") || formats.includes("research_backed") || intents.some((intent) => deepIntents.has(intent));
  const practical = profile.persona === "builder" || formats.includes("learn_by_building") || intents.some((intent) => practicalIntents.has(intent));
  const basics = profile.level === "beginner" || (!deep && !practical);
  const lanes: DiscoveryLane[] = [];
  if (basics) lanes.push("beginner_friendly");
  if (practical) lanes.push("practical");
  if (deep) lanes.push("in_depth");
  return [...lanes.slice(0, 2), "recent"];
}
