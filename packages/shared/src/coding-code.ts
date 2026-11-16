import type { CodingLanguage, CompareMode, NumericTolerance, Signature, ValueType } from "./coding.js";

/**
 * Code-shaped helpers shared by the app and the runner: checking values against a signature's types, comparing returned
 * values, reading learner-typed inputs, and each language's names for the types and starter code.
 */

const INT_MAX = 2 ** 31 - 1;
// Longs stay within what JSON numbers carry exactly everywhere, so JavaScript solutions and comparisons agree.
const LONG_MAX = Number.MAX_SAFE_INTEGER;

/** Why `value` is not a well-formed `type`, or null when it is. */
export function typeError(type: ValueType, value: unknown, path = "value"): string | null {
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) return `${path} must be a list`;
    const inner = type.slice(0, -2) as ValueType;
    for (let index = 0; index < value.length; index += 1) {
      const error = typeError(inner, value[index], `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }
  switch (type) {
    case "int":
      return Number.isInteger(value) && Math.abs(value as number) <= INT_MAX + 1 && (value as number) <= INT_MAX ? null : `${path} must be a 32-bit integer`;
    case "long":
      return Number.isSafeInteger(value) && Math.abs(value as number) <= LONG_MAX ? null : `${path} must be an integer within ±${LONG_MAX}`;
    case "double":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a finite number`;
    case "bool":
      return typeof value === "boolean" ? null : `${path} must be true or false`;
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    default:
      return `${path} has an unknown type`;
  }
}

/** Why `args` don't fit the signature, or null. */
export function argsError(signature: Signature, args: unknown): string | null {
  if (!Array.isArray(args) || args.length !== signature.params.length) return `expected ${signature.params.length} argument${signature.params.length === 1 ? "" : "s"}`;
  for (const [index, param] of signature.params.entries()) {
    const error = typeError(param.type, args[index], param.name);
    if (error) return error;
  }
  return null;
}

/** A total order on JSON values, so lists compared without order can be sorted the same way. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "number" ? Number(item.toPrecision(12)) : item));
}

function close(expected: number, actual: number, tolerance?: NumericTolerance): boolean {
  return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= (tolerance?.absolute ?? 1e-6) + (tolerance?.relative ?? 1e-6) * Math.abs(expected);
}

/** Whether a returned value equals the expected one, for the declared return type; doubles agree within 1e-6 (relative past 1). */
export function sameValue(type: ValueType, expected: unknown, actual: unknown, mode: CompareMode = "exact", tolerance?: NumericTolerance): boolean {
  if (type.endsWith("[]")) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
    const inner = type.slice(0, -2) as ValueType;
    const [left, right] = mode === "unordered" ? [[...expected].sort((a, b) => canonical(a).localeCompare(canonical(b))), [...actual].sort((a, b) => canonical(a).localeCompare(canonical(b)))] : [expected, actual];
    return left.every((item, index) => sameValue(inner, item, right[index], "exact", tolerance));
  }
  if (type === "double") return typeof actual === "number" && typeof expected === "number" && close(expected, actual, tolerance);
  if (type === "int" || type === "long") return typeof actual === "number" && Number.isInteger(actual) && actual === expected;
  return actual === expected;
}

/**
 * Parses learner-typed input: one JSON value per line, one line per parameter (as the examples show it). Returns the
 * arguments or why they could not be read.
 */
export function parseCaseText(signature: Signature, text: string): { args: unknown[] } | { error: string } {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== signature.params.length) return { error: `Put one value per line: ${signature.params.map((param) => param.name).join(", ")}.` };
  const args: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      args.push(JSON.parse(line));
    } catch {
      return { error: `${signature.params[index]!.name} isn't valid JSON.` };
    }
  }
  const error = argsError(signature, args);
  return error ? { error } : { args };
}

/** Parses model-written JSON text for a value and checks it against its type. */
export function parseTyped(type: ValueType, text: string): unknown {
  const value: unknown = JSON.parse(text);
  const error = typeError(type, value);
  if (error) throw new Error(error);
  return value;
}

export const baseType = (type: ValueType) => type.replace(/\[\]/g, "") as "int" | "long" | "double" | "bool" | "string";
export const typeDepth = (type: ValueType) => (type.match(/\[\]/g) ?? []).length;

export function pythonType(type: ValueType): string {
  const scalar = { int: "int", long: "int", double: "float", bool: "bool", string: "str" }[baseType(type)];
  return Array.from({ length: typeDepth(type) }).reduce<string>((inner) => `List[${inner}]`, scalar);
}

export function jsType(type: ValueType): string {
  return `${{ int: "number", long: "number", double: "number", bool: "boolean", string: "string" }[baseType(type)]}${"[]".repeat(typeDepth(type))}`;
}

export function javaType(type: ValueType): string {
  return `${{ int: "int", long: "long", double: "double", bool: "boolean", string: "String" }[baseType(type)]}${"[]".repeat(typeDepth(type))}`;
}

export function cppType(type: ValueType): string {
  const scalar = { int: "int", long: "long long", double: "double", bool: "bool", string: "string" }[baseType(type)];
  return Array.from({ length: typeDepth(type) }).reduce<string>((inner) => `vector<${inner}>`, scalar);
}

export const cppParam = (type: ValueType) => (typeDepth(type) > 0 || baseType(type) === "string" ? `${cppType(type)}&` : cppType(type));

/** The code a learner starts from in each language, shaped as LeetCode shapes it. */
export function starterCode(signature: Signature, language: CodingLanguage): string {
  const { functionName: name, params, returns } = signature;
  switch (language) {
    case "python":
      return `from typing import List\n\n\nclass Solution:\n    def ${name}(self, ${params.map((param) => `${param.name}: ${pythonType(param.type)}`).join(", ")}) -> ${pythonType(returns)}:\n        pass\n`;
    case "javascript":
      return `/**\n${params.map((param) => ` * @param {${jsType(param.type)}} ${param.name}\n`).join("")} * @return {${jsType(returns)}}\n */\nfunction ${name}(${params.map((param) => param.name).join(", ")}) {\n    \n}\n`;
    case "typescript":
      return `function ${name}(${params.map((param) => `${param.name}: ${jsType(param.type)}`).join(", ")}): ${jsType(returns)} {\n    \n}\n`;
    case "java":
      return `class Solution {\n    public ${javaType(returns)} ${name}(${params.map((param) => `${javaType(param.type)} ${param.name}`).join(", ")}) {\n        \n    }\n}\n`;
    case "cpp":
      return `class Solution {\npublic:\n    ${cppType(returns)} ${name}(${params.map((param) => `${cppParam(param.type)} ${param.name}`).join(", ")}) {\n        \n    }\n};\n`;
  }
}

