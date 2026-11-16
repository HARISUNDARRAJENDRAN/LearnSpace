import { z } from "zod";
import { paperCitationAnchorSchema } from "./contracts.js";

const anchorList = z.array(paperCitationAnchorSchema).min(1).max(8);
const text = z.string().trim().min(1).max(1200);

export const researchGuideSchema = z.object({
  title: z.string().trim().min(1).max(120),
  mechanism: z.string().trim().min(1).max(300),
  objective: text,
  prerequisites: z.array(z.object({ name: text, why: text }).strict()).max(12),
  relationship: z.object({ text, anchors: anchorList }).strict(),
  motivation: z.object({ scenario: text, prediction: text, answer: text, anchors: anchorList }).strict(),
  workedExample: z.object({ steps: z.array(z.object({ text, latex: z.string().max(500).optional(), values: z.record(z.string(), z.number().finite()).optional(), anchors: anchorList }).strict()).min(2).max(12) }).strict(),
  explorer: z.object({
    parameters: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), label: text, symbol: z.string().max(32), values: z.array(z.number().finite()).min(1).max(400) }).strict()).max(3),
    outputs: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), label: text, symbol: z.string().max(32) }).strict()).min(1).max(8),
    table: z.array(z.object({ parameters: z.record(z.string(), z.number().finite()), outputs: z.record(z.string(), z.number().finite()) }).strict()).max(400),
    chart: z.object({ xParameter: z.string(), outputs: z.array(z.string()).min(1).max(8) }).strict().optional(),
  }).strict().superRefine((value, ctx) => {
    const grid = value.parameters.reduce((n, parameter) => n * parameter.values.length, 1);
    if (grid > 400) ctx.addIssue({ code: "custom", message: "explorer exceeds 400 grid points", path: ["parameters"] });
    if (new Set(value.parameters.map((item) => item.id)).size !== value.parameters.length) ctx.addIssue({ code: "custom", message: "parameter ids must be unique", path: ["parameters"] });
    if (new Set(value.outputs.map((item) => item.id)).size !== value.outputs.length) ctx.addIssue({ code: "custom", message: "output ids must be unique", path: ["outputs"] });
    if (value.chart && (!value.parameters.some((item) => item.id === value.chart!.xParameter) || value.chart.outputs.some((id) => !value.outputs.some((item) => item.id === id)))) ctx.addIssue({ code: "custom", message: "chart references unknown ids", path: ["chart"] });
    if (value.table.length !== grid) ctx.addIssue({ code: "custom", message: "explorer table must cover every grid point", path: ["table"] });
  }),
  edgeCases: z.array(z.object({ setup: text, prediction: text, answer: text, anchors: anchorList }).strict()).min(1).max(8),
  mapping: z.array(z.object({ toy: text, fullSystem: text, anchors: anchorList }).strict()).min(2).max(8),
  caveats: z.array(z.object({ text, anchors: anchorList }).strict()).min(1).max(8),
  project: z.object({
    steps: z.array(z.object({ text, anchors: anchorList }).strict()).min(2).max(12),
    expectedResults: z.array(text).min(1).max(8),
    validation: text,
    misconceptions: z.array(text).max(8),
    furtherExploration: z.array(text).max(8),
    gpuReproductionPlan: z.object({ label: z.literal("For future GPU access"), steps: z.array(text).min(1).max(8) }).strict().optional(),
  }).strict(),
  takeaways: z.array(z.object({ text, anchors: anchorList }).strict()).min(2).max(8),
}).strict();

export type ResearchGuide = z.infer<typeof researchGuideSchema>;

