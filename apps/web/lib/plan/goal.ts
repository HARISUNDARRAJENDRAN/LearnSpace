import { withUserTransaction } from "@learnspace/db";
import { scheduleItems } from "@learnspace/db/schema";
import { z } from "zod";
import { openAiConfigured, structuredCompletion } from "../ai/openai";
import { PLAN_KINDS, type PlanKind } from "./kinds";

// The learner states a goal (during onboarding); the planning agent turns it into a week of to-dos.
// `days` are the learner's local midnights for the coming days, so all-day items land on their own calendar days.
export const goalPlanSchema = z.object({
  goal: z.string().trim().min(3, "Tell us a little more about your goal.").max(300),
  interests: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  days: z.array(z.iso.datetime({ offset: true })).min(1).max(7),
}).strict();

export type GoalPlanInput = z.input<typeof goalPlanSchema>;
export type GoalTodo = { title: string; reason: string; kind: PlanKind; day: number };

const todoSchema = z.object({ todos: z.array(z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().max(400),
  kind: z.enum(PLAN_KINDS),
  day: z.number().int(),
})).min(1).max(5) });

const todoJsonSchema = {
  type: "object", additionalProperties: false, required: ["todos"],
  properties: { todos: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "reason", "kind", "day"], properties: {
    title: { type: "string" }, reason: { type: "string" }, kind: { type: "string", enum: PLAN_KINDS }, day: { type: "integer" },
  } } } },
};

// Without the model the goal itself becomes today's to-do, so the step never leaves the list empty.
export function fallbackTodos(goal: string): GoalTodo[] {
  return [{ title: goal.slice(0, 160), reason: "Your goal from setup.", kind: "practice", day: 0 }];
}

async function draftTodos(goal: string, interests: string[], days: number): Promise<GoalTodo[]> {
  if (!openAiConfigured()) return fallbackTodos(goal);
  try {
    const result = await structuredCompletion({
      name: "goal_todos",
      system: `You are the LearnSpace planning agent. Break the learner's current goal into three to five concrete to-dos for the next ${days} days, smallest useful first step on day 0. Each title is an imperative under 60 characters (for example "Watch an intro to binary search trees"). The kind is watch for videos, read for papers and articles, practice for exercises, coding and building, and review for revising. day is 0 for today up to ${days - 1}. The reason is one short sentence tying the to-do to the goal.`,
      user: JSON.stringify({ goal, interests }),
      jsonSchema: todoJsonSchema,
      parser: todoSchema,
    });
    return result.todos.map((todo) => ({ ...todo, day: Math.max(0, Math.min(days - 1, todo.day)) }));
  } catch (error) {
    console.error("[plan-goal] drafting failed", error);
    return fallbackTodos(goal);
  }
}

export async function planGoal(userId: string, input: GoalPlanInput): Promise<{ created: number }> {
  const value = goalPlanSchema.parse(input);
  const todos = await draftTodos(value.goal, value.interests, value.days.length);
  const now = new Date();
  await withUserTransaction(userId, async (tx) => {
    await tx.insert(scheduleItems).values(todos.map((todo) => ({
      userId,
      kind: todo.kind,
      status: "planned",
      source: "agent",
      title: todo.title,
      description: todo.reason || null,
      startsAt: new Date(value.days[todo.day]!),
      endsAt: null,
      allDay: true,
      createdAt: now,
      updatedAt: now,
    })));
  });
  return { created: todos.length };
}
