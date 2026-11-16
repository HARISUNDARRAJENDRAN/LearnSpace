/**
 * The server side of the client benchmark's end-to-end mode (`--server real`): each spoken turn goes through what the
 * voice route does, the sign-in and onboarding check and then `runVoiceTurn`, against the local database reached through
 * a proxy that adds a fixed round trip. Only the tutor model is a stand-in, with fixed timings (its real first output,
 * about 1.08 s p50 in `agent.model_invocations`), so the same reply arrives at the same pace before and after.
 */
import { voiceTurnRequestSchema } from "@learnspace/shared/notes";
import postgres from "postgres";
import type { TutorModel } from "../lib/ai/tutor-model";
import { appModules, createLearner, createLesson, gateOf, type Learner, latencyProxy, removeFixture, through } from "./benchmark-notes-fixture";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const usage = { inputTokens: 6_000, cachedTokens: 5_000, cacheWriteTokens: 0, outputTokens: 60, reasoningTokens: 0, fast: true };

export type Backend = {
  /** One turn, its NDJSON events written as the route streams them. */
  turn: (scenario: string, body: unknown, write: (line: string) => void) => Promise<void>;
  close: () => Promise<void>;
};

export async function startBackend(options: { rttMs: number; replies: Record<string, string[]>; firstOutputMs: number; tokenMs: number }): Promise<Backend> {
  const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
  const appUrl = process.env.DATABASE_URL;
  const authUrl = process.env.DATABASE_AUTH_URL;
  if (!migratorUrl || !appUrl || !authUrl) throw new Error("DATABASE_MIGRATOR_URL, DATABASE_URL and DATABASE_AUTH_URL are required (the local database)");
  if (![appUrl, authUrl, migratorUrl].every((url) => /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname))) throw new Error("Benchmarks run against the local database only.");
  const migrator = postgres(migratorUrl, { max: 1, prepare: false, connect_timeout: 10 });
  const lesson = await createLesson(migrator);
  const [{ closeDb }, notes, modules] = await Promise.all([import("@learnspace/db"), import("../lib/notes/service"), appModules()]);
  const gate = gateOf(modules);
  const learners = new Map<string, Learner>();
  for (const scenario of Object.keys(options.replies)) learners.set(scenario, await createLearner(migrator, modules, lesson));
  // From here on the app reaches the database only through the proxies.
  await closeDb();
  const app = await latencyProxy({ host: "127.0.0.1", port: Number(new URL(appUrl).port || 5432) }, options.rttMs);
  const auth = await latencyProxy({ host: "127.0.0.1", port: Number(new URL(authUrl).port || 5432) }, options.rttMs);
  process.env.DATABASE_URL = through(appUrl, app.port);
  process.env.DATABASE_AUTH_URL = through(authUrl, auth.port);

  return {
    async turn(scenario, body, write) {
      const learner = learners.get(scenario);
      if (!learner) throw new Error(`no learner for ${scenario}`);
      await gate(learner.token);
      const input = voiceTurnRequestSchema.parse(body);
      const pieces = options.replies[scenario] ?? [];
      const model: TutorModel = async (_request, { onText, onFirstOutput }) => {
        await sleep(options.firstOutputMs);
        onFirstOutput?.();
        let text = "";
        for (const piece of pieces) { text += piece; onText?.(text); await sleep(options.tokenMs); }
        return { text, refusal: null, usage, firstOutputMs: options.firstOutputMs, latencyMs: options.firstOutputMs + pieces.length * options.tokenMs };
      };
      await notes.runVoiceTurn(learner.userId, learner.sessionId, input, { signal: new AbortController().signal, emit: (event) => write(`${JSON.stringify(event)}\n`), model });
    },
    async close() {
      await closeDb();
      app.close();
      auth.close();
      process.env.DATABASE_URL = appUrl;
      process.env.DATABASE_AUTH_URL = authUrl;
      await removeFixture(migrator, lesson, [...learners.values()].map((learner) => learner.userId));
      await migrator.end({ timeout: 5 });
    },
  };
}
