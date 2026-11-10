import "katex/dist/katex.min.css";
import katex from "katex";
import { Fragment, type ReactNode } from "react";
import { mathParts } from "../../lib/math";

/**
 * Text with its LaTeX rendered by KaTeX; everything else goes through `render`. A formula that fails to parse shows as
 * written. While `partial` (an answer still streaming in), a formula that hasn't closed yet is held back.
 */
export function MathText({ text, partial = false, render = (part) => part }: { text: string; partial?: boolean; render?: (part: string) => ReactNode }) {
  // A text never reorders, so its parts are keyed by position.
  return <>{mathParts(text, partial).map((part, index) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: see above.
    if (typeof part === "string") return <Fragment key={index}>{render(part)}</Fragment>;
    const html = katex.renderToString(part.tex, { displayMode: part.display, throwOnError: false, output: "htmlAndMathml" });
    // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX escapes the source and, with trust off, emits only its own markup.
    // biome-ignore lint/suspicious/noArrayIndexKey: see above.
    return <span key={index} className={part.display ? "math-display" : "math"} dangerouslySetInnerHTML={{ __html: html }} />;
  })}</>;
}
