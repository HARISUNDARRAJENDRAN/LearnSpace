// What image, link and table blocks hold, read without the page, so tests and the server can share it.

export function safeNoteUrl(text: string): { url: string; caption: string } | null {
  const [raw = "", ...rest] = text.split("\n");
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { url: url.href, caption: rest.join("\n").trim() || url.hostname };
  } catch { return null; }
}

/** A Markdown table's cells, header first; the |---| row is left out. */
export function tableRows(text: string): string[][] {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !/^\|?[\s:|-]+\|?$/.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}
