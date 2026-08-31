import { z } from "zod";

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_FEATURE_VERSION = "onboarding-v1";

export const PERSONAS = [
  "student",
  "professional",
  "researcher",
  "builder",
  "lifelong_learner",
  "other",
] as const;

export const PERSONA_INTENTS = {
  student: [
    "coursework",
    "exams",
    "placements_interviews",
    "learn_new_skill",
    "build_project",
    "research",
    "explore",
  ],
  professional: [
    "upskill_current_role",
    "career_switch",
    "interview_preparation",
    "learn_new_technology",
    "build_something",
    "keep_up_with_field",
    "explore_outside_work",
  ],
  researcher: [
    "read_papers",
    "follow_research_area",
    "understand_unfamiliar_concepts",
    "reproduce_implementations",
    "literature_review",
    "discover_related_work",
    "teaching_preparation",
  ],
  builder: [
    "build_project",
    "learn_technology",
    "prototype_idea",
    "understand_how_something_works",
    "improve_skill",
    "find_inspiration",
  ],
  lifelong_learner: [
    "understand_something_deeply",
    "explore_interesting_topics",
    "develop_new_skills",
    "read_more_deeply",
    "follow_curiosity",
  ],
  other: [
    "understand_something_deeply",
    "explore_interesting_topics",
    "develop_new_skills",
    "read_more_deeply",
    "follow_curiosity",
  ],
} as const satisfies Record<(typeof PERSONAS)[number], readonly string[]>;

export const PREFERRED_FORMATS = [
  "clear_explanations",
  "deep_dives",
  "learn_by_building",
  "research_backed",
  "quick_learning",
  "conversational_tutor_led",
] as const;

export const PREFERRED_DURATIONS = [
  "under_10_minutes",
  "ten_to_thirty_minutes",
  "thirty_to_sixty_minutes",
  "no_preference",
] as const;

export const SELF_REPORTED_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "mixed",
] as const;

export const STARTING_LEVEL_OPTIONS = [
  { id: "beginner", label: "Just getting started", value: "beginner" },
  { id: "basics", label: "I know the basics", value: "intermediate" },
  { id: "comfortable", label: "I'm fairly comfortable", value: "intermediate" },
  { id: "advanced", label: "I'm advanced", value: "advanced" },
  { id: "mixed", label: "It depends on the topic", value: "mixed" },
] as const satisfies readonly {
  id: string;
  label: string;
  value: (typeof SELF_REPORTED_LEVELS)[number];
}[];

const personaSchema = z.enum(PERSONAS);
const preferredFormatSchema = z.enum(PREFERRED_FORMATS);
const preferredDurationSchema = z.enum(PREFERRED_DURATIONS);
const selfReportedLevelSchema = z.enum(SELF_REPORTED_LEVELS);

const onboardingPreferenceFields = {
  persona: personaSchema,
  learningIntents: z.array(z.string().min(1)).min(1).max(7),
  preferredFormats: z.array(preferredFormatSchema).min(1).max(6),
  preferredDuration: preferredDurationSchema,
  selfReportedLevel: selfReportedLevelSchema,
};

const onboardingDraftFields = {
  persona: personaSchema.optional(),
  learningIntents: z.array(z.string().min(1)).max(7).optional(),
  preferredFormats: z.array(preferredFormatSchema).max(6).optional(),
  preferredDuration: preferredDurationSchema.optional(),
  selfReportedLevel: selfReportedLevelSchema.optional(),
};

function validatePersonaIntents(
  value: {
    persona?: (typeof PERSONAS)[number] | undefined;
    learningIntents?: string[] | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (!value.persona || !value.learningIntents) {
    return;
  }

  const allowed = PERSONA_INTENTS[value.persona];
  if (value.learningIntents.some((intent) => !allowed.some((candidate) => candidate === intent))) {
    context.addIssue({
      code: "custom",
      path: ["learningIntents"],
      message: "Choose learning intentions for the selected persona.",
    });
  }
}

export const onboardingPreferencesSchema = z
  .object(onboardingPreferenceFields)
  .superRefine(validatePersonaIntents);

export const onboardingDraftSchema = z
  .object({
    ...onboardingDraftFields,
    conceptIds: z.array(z.string().uuid()).max(20).optional(),
    draftRevision: z.number().int().positive().optional(),
  })
  .superRefine(validatePersonaIntents);

export const onboardingDraftRequestSchema = z
  .object({
    ...onboardingDraftFields,
    conceptIds: z.array(z.string().uuid()).max(20).optional(),
    draftRevision: z.number().int().positive(),
  })
  .superRefine(validatePersonaIntents);

export const onboardingCompletionSchema = z
  .object({
    ...onboardingPreferenceFields,
    conceptIds: z.array(z.string().uuid()).min(3).max(20),
  })
  .superRefine((value, context) => {
    validatePersonaIntents(value, context);
    if (new Set(value.conceptIds).size !== value.conceptIds.length) {
      context.addIssue({
        code: "custom",
        path: ["conceptIds"],
        message: "Choose each interest only once.",
      });
    }
  });

export type Persona = (typeof PERSONAS)[number];
export type PreferredFormat = (typeof PREFERRED_FORMATS)[number];
export type PreferredDuration = (typeof PREFERRED_DURATIONS)[number];
export type SelfReportedLevel = (typeof SELF_REPORTED_LEVELS)[number];
export type StartingLevelOptionId = (typeof STARTING_LEVEL_OPTIONS)[number]["id"];
export type OnboardingPreferences = z.infer<typeof onboardingPreferencesSchema>;
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;
export type OnboardingDraftRequest = z.infer<typeof onboardingDraftRequestSchema>;
export type OnboardingCompletion = z.infer<typeof onboardingCompletionSchema>;
