// The models write math as LaTeX: $…$ inline and $$…$$ on its own line (\(…\) and \[…\] also work). A single $ only
// opens math before a non-space and closes after one, never before a digit, so "$5 and $10" stays money.
export const MATH = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?!\d))/;
// Any opener left in plain text is a formula still being written. Formulas often start with a digit, so a price at the
// very end of a streaming answer waits too, until the text runs on past it.
const OPEN = /\$\$|\\\(|\\\[|\$(?=[^\s$])/g;
// How far past an unclosed opener a streaming formula may run before it is taken as plain text (a lone "$").
const STILL_WRITING = 80;

export type MathPart = string | { tex: string; display: boolean };

/** Splits text into plain runs and formulas. While `partial`, a formula still being written at the end is held back. */
export function mathParts(text: string, partial = false): MathPart[] {
  const parts: MathPart[] = text.split(MATH).map((part, index) => {
    if (index % 2 === 0) return part;
    const display = part.startsWith("$$") || part.startsWith("\\[");
    return { tex: part.startsWith("$") && !display ? part.slice(1, -1) : part.slice(2, -2), display };
  });
  const last = parts.at(-1);
  if (partial && typeof last === "string") {
    const open = [...last.matchAll(OPEN)].at(-1)?.index ?? -1;
    if (open >= 0 && last.length - open <= STILL_WRITING) parts[parts.length - 1] = last.slice(0, open);
  }
  return parts.filter((part) => part !== "");
}

// JSON escapes that collide with LaTeX: a model writing \times, \frac, \beta or \rho with one backslash produces a tab,
// form feed, backspace or carriage return. In text that holds math, one of those before a letter is that command.
const COLLISIONS: Record<string, string> = { "\t": "t", "\f": "f", "\b": "b", "\r": "r" };

export function restoreLatex(text: string): string {
  if (!/\$|\\\(|\\\[/.test(text)) return text;
  return text.replace(/[\t\f\b\r](?=[a-zA-Z])/g, (char) => `\\${COLLISIONS[char]}`);
}
