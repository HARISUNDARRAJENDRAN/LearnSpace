import type { Execute } from "../executor.js";

/**
 * The problem's own Python tooling, run in the sandbox like any untrusted code (a model wrote it):
 *   generator.py  def generate(rng: random.Random, size: str) -> list   one argument list; size is "small" or "large"
 *   validator.py  def validate(*args) -> None | bool                     False or an exception rejects the input
 *   reference.py  def solve(*args)                                       the optimal reference
 * Each task reads its input as JSON on stdin and writes one JSON line per item to fd 3.
 */
const TOOL = String.raw`
import json, os, random, sys, threading, traceback

out = os.fdopen(3, "w", encoding="utf-8")
task = json.loads(sys.stdin.read())


def load(name, entry):
    namespace = {"__name__": name}
    with open(name + ".py", encoding="utf-8") as source:
        exec(compile(source.read(), name + ".py", "exec"), namespace)
    function = namespace.get(entry)
    if not callable(function):
        raise NameError(name + ".py does not define " + entry)
    return function


def write(value):
    out.write(json.dumps(value) + "\n")
    out.flush()


def reason(error):
    text = str(error).strip()
    return (type(error).__name__ + (": " + text if text else ""))[:300]


def check(validate, args):
    try:
        verdict = validate(*args)
    except BaseException as error:
        return False, reason(error)
    if verdict is False:
        return False, "outside the problem's constraints"
    return True, None


def main():
    try:
        validate = load("validator", "validate")
        if task["kind"] == "prepare":
            for index, args in enumerate(task["authored"]):
                ok, why = check(validate, args)
                write({"a": index, "valid": ok, "reason": why})
            generate = load("generator", "generate")
            for size, count in (("small", task["small"]), ("large", task["large"])):
                for index in range(count):
                    rng = random.Random(task["seed"] * 100003 + (index if size == "small" else 50000 + index))
                    try:
                        args = generate(rng, size)
                    except BaseException as error:
                        write({"g": size, "error": reason(error)})
                        return
                    if isinstance(args, tuple):
                        args = list(args)
                    ok, why = check(validate, args) if isinstance(args, list) else (False, "generate must return a list of arguments")
                    write({"g": size, "args": args, "valid": ok, "reason": why})
        elif task["kind"] == "solve":
            solve = load("reference", "solve")
            for index, args in enumerate(task["cases"]):
                ok, why = check(validate, args)
                if not ok:
                    write({"i": index, "valid": False, "reason": why})
                    continue
                try:
                    write({"i": index, "valid": True, "ok": True, "v": solve(*args)})
                except BaseException as error:
                    write({"i": index, "valid": True, "ok": False, "reason": reason(error)})
    except BaseException as error:
        write({"fatal": reason(error), "trace": traceback.format_exc()[-1500:]})


sys.setrecursionlimit(1 << 20)
threading.stack_size(256 << 20)
worker = threading.Thread(target=main)
worker.start()
worker.join()
`;

export type ReferenceSources = { generator: string; validator: string; reference: string };

export class ReferenceToolError extends Error {}

function lines(result: string): Array<Record<string, unknown>> {
  const parsed: Array<Record<string, unknown>> = [];
  for (const line of result.split("\n")) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // A line cut off by the result limit: what came before it still counts.
    }
  }
  return parsed;
}

async function runTool(execute: Execute, sources: ReferenceSources, task: unknown, timeoutMs: number) {
  const response = await execute({
    language: "python",
    files: { "main.py": TOOL, "generator.py": sources.generator, "validator.py": sources.validator, "reference.py": sources.reference },
    runs: [{ stdin: JSON.stringify(task), timeoutMs }],
    memoryMb: 1_024,
    resultLimit: 24 << 20,
  });
  const report = response.runs[0];
  if (!report) throw new ReferenceToolError(response.compile?.output.slice(0, 500) || "the problem's tooling did not run");
  const parsed = lines(report.result);
  const fatal = parsed.find((line) => typeof line.fatal === "string");
  if (fatal) throw new ReferenceToolError(String(fatal.fatal));
  if (report.status !== "ok") throw new ReferenceToolError(`the problem's tooling stopped: ${report.status}`);
  return parsed;
}

export type Prepared = {
  authored: Array<{ valid: boolean; reason: string | null }>;
  small: Array<{ args: unknown; valid: boolean; reason: string | null }>;
  large: Array<{ args: unknown; valid: boolean; reason: string | null }>;
};

/** Validates the authored cases and generates (and validates) random small and large ones. */
export async function prepareCases(execute: Execute, sources: ReferenceSources, input: { authored: unknown[][]; small: number; large: number; seed: number }): Promise<Prepared> {
  const parsed = await runTool(execute, sources, { kind: "prepare", ...input }, 25_000);
  const failed = parsed.find((line) => typeof line.g === "string" && typeof line.error === "string");
  if (failed) throw new ReferenceToolError(`generate failed: ${String(failed.error)}`);
  const prepared: Prepared = { authored: [], small: [], large: [] };
  for (const line of parsed) {
    const verdict = { valid: line.valid === true, reason: typeof line.reason === "string" ? line.reason : null };
    if (typeof line.a === "number") prepared.authored[line.a] = verdict;
    else if (line.g === "small") prepared.small.push({ args: line.args, ...verdict });
    else if (line.g === "large") prepared.large.push({ args: line.args, ...verdict });
  }
  if (prepared.authored.length !== input.authored.length || prepared.small.length !== input.small || prepared.large.length !== input.large) {
    throw new ReferenceToolError("the problem's tooling did not answer for every case");
  }
  return prepared;
}

export type Solved = { valid: false; reason: string } | { valid: true; ok: true; value: unknown } | { valid: true; ok: false; reason: string };

/** Checks inputs against the validator and answers the valid ones with the reference. */
export async function solveCases(execute: Execute, sources: ReferenceSources, cases: unknown[][]): Promise<Solved[]> {
  if (cases.length === 0) return [];
  const parsed = await runTool(execute, sources, { kind: "solve", cases }, 10_000);
  return cases.map((_, index): Solved => {
    const line = parsed.find((item) => item.i === index);
    if (!line) return { valid: true, ok: false, reason: "the reference did not finish" };
    if (line.valid !== true) return { valid: false, reason: typeof line.reason === "string" ? line.reason : "outside the problem's constraints" };
    return line.ok === true ? { valid: true, ok: true, value: line.v ?? null } : { valid: true, ok: false, reason: String(line.reason ?? "the reference failed") };
  });
}
