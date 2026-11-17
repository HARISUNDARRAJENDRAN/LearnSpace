import type { Rank } from "../../lib/plan/levels";

export function Medal({ rank, size = 56, dim = false }: { rank: Rank; size?: number; dim?: boolean }) {
  return <svg className={`home-medal is-${rank.toLowerCase()}${dim ? " is-dim" : ""}`} width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
    <path className="home-medal-ribbon" d="M18 4h8l-4 14h-8zM30 4h8l2 14h-8z" />
    <path className="home-medal-face" d="M28 14l14.7 8.5v17L28 48l-14.7-8.5v-17z" />
    <path className="home-medal-shine" d="M28 20l9.5 5.5v11L28 42l-9.5-5.5v-11z" />
  </svg>;
}
