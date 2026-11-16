import type { CSSProperties } from "react";

/**
 * A folder whose papers lift on hover and fan out when it opens. The motion is CSS (see library.css), driven by the
 * parent's :hover and `data-open`, so it needs no animation library and the folder can sit inside a button.
 */
const themes = {
  black: {
    backFill: "#000", backShadow: "inset 0 0 6px 2px rgba(255,255,255,0.37)",
    flapFill: "#292929", flapFillOpacity: 0.25, flapStroke: "#979797", flapInset: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0",
    cardFill: "#F1F1F1", cardStroke: "#E0E0E0", cardLine: "#D4D4D4", cardInset: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0",
  },
  white: {
    backFill: "#fff", backShadow: "inset 0 0 6px 2px rgba(178,178,178,0.25)",
    flapFill: "#f5f5f5", flapFillOpacity: 0.85, flapStroke: "#d4d4d4", flapInset: "0 0 0 0 0.6 0 0 0 0 0.6 0 0 0 0 0.6 0 0 0 0.15 0",
    cardFill: "#262626", cardStroke: "#404040", cardLine: "#737373", cardInset: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.15 0",
  },
  blue: {
    backFill: "#50B1FD", backShadow: "inset 0 0 6px 2px rgba(255,255,255,0.35)",
    flapFill: "#3a9ae8", flapFillOpacity: 0.45, flapStroke: "#7ec8ff", flapInset: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.12 0",
    cardFill: "#F1F1F1", cardStroke: "#E0E0E0", cardLine: "#D4D4D4", cardInset: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0",
  },
} as const;

export type FolderColor = keyof typeof themes;
type Theme = (typeof themes)[FolderColor];

const FLAP_PATH = "M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z";
// The two columns of ruled lines on each paper.
const LINE_ROWS = [60.99, 75.11, 89.23, 103.35, 117.47, 131.59, 145.7, 159.82, 173.94];

export function Folder({ color = "black", scale = 0.65, open = false, id }: { color?: FolderColor; scale?: number; open?: boolean; id: string }) {
  const theme = themes[color];
  const filter = `folder-flap-${id}`;
  return (
    <span className="folder" data-open={open || undefined} style={{ "--folder-scale": scale } as CSSProperties} aria-hidden="true">
      <span className="folder-stage">
        <span className="folder-back" style={{ background: theme.backFill, boxShadow: theme.backShadow }} />
        {[1, 2, 3].map((card) => <span key={card} className="folder-paper" data-paper={card}><Paper id={`${id}-${card}`} theme={theme} /></span>)}
        <span className="folder-flap">
          <span className="folder-flap-glass" style={{ clipPath: `path('${FLAP_PATH}')` }} />
          <svg aria-hidden="true" width="321" height="241" viewBox="0 0 321 241" fill="none">
            <g filter={`url(#${filter})`}>
              <path d={FLAP_PATH} fill={theme.flapFill} fillOpacity={theme.flapFillOpacity} />
              <path d="M25 0.5H136.084C142.905 0.5 149.417 3.3431 154.054 8.3457L177.713 33.874C182.539 39.0808 189.317 42.04 196.416 42.04H296C309.531 42.04 320.5 53.0092 320.5 66.54V216C320.5 229.531 309.531 240.5 296 240.5H25C11.469 240.5 0.5 229.531 0.5 216V25C0.5 11.469 11.469 0.5 25 0.5Z" stroke={theme.flapStroke} />
            </g>
            <defs>
              <filter id={filter} x="-25.4" y="-25.4" width="371.8" height="291.8" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
                <feOffset />
                <feGaussianBlur stdDeviation="2.65" />
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                <feColorMatrix type="matrix" values={theme.flapInset} />
                <feBlend mode="normal" in2="shape" />
              </filter>
            </defs>
          </svg>
        </span>
      </span>
    </span>
  );
}

function Paper({ id, theme }: { id: string; theme: Theme }) {
  const filter = `folder-paper-${id}`;
  return (
    <svg aria-hidden="true" width="164" height="214" viewBox="0 0 164 214" fill="none">
      <g filter={`url(#${filter})`}><rect width="163.078" height="213.262" rx="20" fill={theme.cardFill} /></g>
      <rect x="0.5" y="0.5" width="162.078" height="212.262" rx="19.5" stroke={theme.cardStroke} />
      <rect x="14.12" y="31.21" width="134.84" height="11.89" rx="5.94" fill={theme.cardLine} />
      {LINE_ROWS.map((y) => <g key={y}>
        <rect x="14.83" y={y} width="64.52" height="5.88" rx="2.94" fill={theme.cardLine} />
        <rect x="84.43" y={y} width="64.52" height="5.88" rx="2.94" fill={theme.cardLine} />
      </g>)}
      <defs>
        <filter id={filter} x="0" y="0" width="166.078" height="218.262" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dx="3" dy="5" />
          <feGaussianBlur stdDeviation="3.05" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values={theme.cardInset} />
          <feBlend mode="normal" in2="shape" />
        </filter>
      </defs>
    </svg>
  );
}
