/** Normalizes raw LaTeX markup that frequently leaks into arXiv/Crossref paper titles and abstracts. */

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  pm: "±",
  mp: "∓",
  approx: "≈",
  equiv: "≡",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  ll: "≪",
  gg: "≫",
  sim: "~",
  simeq: "≃",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  Rightarrow: "⇒",
  leftarrow: "←",
  leftrightarrow: "↔",
  infty: "∞",
  dots: "…",
  ldots: "…",
  cdots: "…",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  nabla: "∇",
  partial: "∂",
  ell: "ℓ",
};

const ACCENT_MAP: Record<string, Record<string, string>> = {
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  c: { c: "ç", C: "Ç", s: "ş", S: "Ş" },
  v: { c: "č", s: "š", z: "ž", r: "ř", C: "Č", S: "Š", Z: "Ž" },
};

const TEXT_WRAPPER_RE = /\\(?:text(?:it|bf|tt|rm|sf|sc|normal)?|emph|underline|mathrm|mathbf|mathit|mathsf|mathcal|mathbb|operatorname|mbox|hbox)\s*\{([^{}]*)\}/g;
const OLD_FONT_SWITCH_RE = /\{\\(?:it|bf|em|tt|rm|sc|sl|sf)\b\s*([^{}]*)\}/g;
const FRAC_RE = /\\d?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g;
const SQRT_RE = /\\sqrt\s*\{([^{}]+)\}/g;
const ACCENT_RE = /\\(["'`^~cv])(?:\{([A-Za-z])\}|([A-Za-z]))/g;
const MATH_COMMAND_RE = /\\([A-Za-z]+)\b/g;

function normalizeMathFragment(fragment: string): string {
  let out = fragment
    .replace(/\\(?:left|right|bigl?|bigr?|Bigl?|Bigr?|biggl?|biggr?|displaystyle|textstyle|limits)\b/g, "")
    .replace(FRAC_RE, "$1/$2")
    .replace(SQRT_RE, "√($1)");

  for (let pass = 0; pass < 4; pass += 1) {
    const next = out.replace(TEXT_WRAPPER_RE, "$1");
    if (next === out) break;
    out = next;
  }

  out = out
    .replace(MATH_COMMAND_RE, (full, name: string) => LATEX_SYMBOLS[name] ?? full)
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/\\[,;:]/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\([%&$#_])/g, "$1")
    .replace(/\{([^{}]*)\}/g, "$1");

  return out.replace(/\s+/g, " ").trim();
}

export function cleanLatexText(input: string): string {
  let text = input;

  // Decode LaTeX diacritics like \"{o} or \'e.
  text = text.replace(ACCENT_RE, (full, mark: string, braced?: string, bare?: string) => {
    const letter = braced ?? bare ?? "";
    return ACCENT_MAP[mark]?.[letter] ?? full;
  });

  // Unwrap nested text/math formatting macros such as \textit{...} and \textbf{...}.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = text
      .replace(TEXT_WRAPPER_RE, "$1")
      .replace(OLD_FONT_SWITCH_RE, "$1")
      .replace(FRAC_RE, "$1/$2")
      .replace(SQRT_RE, "√($1)");
    if (next === text) break;
    text = next;
  }

  // Handle \( ... \) and inline $ ... $ math spans without touching currency like "$100 to $200".
  text = text.replace(/\\\(([^)]*?)\\\)/g, (_, inner: string) => normalizeMathFragment(inner));
  text = text.replace(/\$([^\s$](?:[^$\n]{0,120}?[^\s$])?)\$/g, (full, inner: string) => {
    if (/^\d+(?:[.,]\d+)?$/.test(inner) || /\s(?:and|to|or)\s/.test(inner)) return full;
    if (/[\\^_=<>~]/.test(inner) || /^[A-Za-z0-9()+\-*/,.\s]{1,24}$/.test(inner)) {
      return normalizeMathFragment(inner);
    }
    return full;
  });

  // Replace standalone LaTeX commands (e.g. \times, \approx) and escaped punctuation (\%, \&, \$, \_).
  text = text
    .replace(MATH_COMMAND_RE, (full, name: string) => LATEX_SYMBOLS[name] ?? full)
    .replace(/\\[,;:]/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\([%&$#_{}])/g, "$1")
    .replace(/``/g, '"')
    .replace(/''/g, '"')
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/(?<!\/)~/g, " ");

  // Remove LaTeX grouping braces like 1{,}010 or {MIPS} while keeping balanced text intact.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(/\{([^{}]{1,80})\}/g, "$1");
    if (next === text) break;
    text = next;
  }

  return text.replace(/\s+/g, " ").trim();
}

export function cleanPaperText(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = cleanLatexText(input);
  return cleaned.length > 0 ? cleaned : null;
}
