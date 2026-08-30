import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/source-serif-4/400.css";
import "./styles.css";

const assets = {
  cloud: "/assets/craft/cloud.png",
  paperTexture: "/assets/craft/paper-texture.png",
  sheetTexture: "/assets/craft/sheet-texture.webp",
  blackPaper: "/assets/craft/black-paper.png",
  yellowPaper: "/assets/craft/yellow-paper.webp",
} as const;

const navigation = ["Features", "Community", "Pricing", "Learn"];

const documentCards = [
  {
    title: "Research Notes",
    tone: "pink",
    lines: ["Active recall", "Memory & Learning", "Review queue", "Spaced repetition"],
  },
  {
    title: "Study Plan",
    tone: "white",
    lines: ["Monday", "Deep work", "Tuesday", "Review notes", "Walk & reflect"],
  },
  {
    title: "Reading Queue",
    tone: "yellow",
    lines: ["Designing for focus", "Friday reading", "Saturday", "Sunday"],
  },
  {
    title: "Course Notes",
    tone: "green",
    lines: ["01. Active Recall", "02. Spaced Repetition", "03. Synthesis", "04. Recap"],
  },
] as const;

function LearnSpaceLogo() {
  return (
    <span className="brand-lockup">
      <img className="learnspace-mark" src="/assets/learnspace-mark.svg" alt="" />
      <span className="brand-name">LEARNSPACE</span>
    </span>
  );
}

function Navigation() {
  return (
    <header className="nav-shell">
      <a className="brand" href="#hero" aria-label="LearnSpace home">
        <LearnSpaceLogo />
      </a>
      <nav className="nav-links" aria-label="Main navigation">
        {navigation.map((item) => (
          <a key={item} href="#hero">
            {item}
          </a>
        ))}
      </nav>
      <div className="nav-actions">
        <a className="nav-cta" href="#hero">
          Login
        </a>
      </div>
    </header>
  );
}

function LineArt() {
  return (
    <svg className="line-art" viewBox="0 0 1440 269" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 0H1440" />
        <path d="M0 194.5H1440" />
        <path d="M251.5 0V269" />
        <path d="M586.5 0V269" />
        <path d="M911.5 0V269" />
        <path d="M1117.5 0V269" />
        <path d="M0 0C102 0 176 57 176 104S102 208 0 208" />
        <path d="M1440 0C1338 0 1264 57 1264 104S1338 208 1440 208" />
        <path d="M251 0C251 93 180 168 87 168" />
        <path d="M1118 0C1118 93 1189 168 1282 168" />
      </g>
    </svg>
  );
}

function PaperCollage() {
  return (
    <div className="collage" aria-hidden="true">
      <img className="paper-texture" src={assets.paperTexture} alt="" />
      <LineArt />
      <img className="cloud cloud-left" src={assets.cloud} alt="" />
      <img className="cloud cloud-right" src={assets.cloud} alt="" />

      <div className="white-torn">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="purple-paper">
        <img src={assets.sheetTexture} alt="" />
      </div>

      <div className="black-paper">
        <img src={assets.blackPaper} alt="" />
      </div>

      <div className="mountain-paper">
        <div className="mountain-shadow" />
      </div>

      <div className="yellow-paper">
        <img src={assets.yellowPaper} alt="" />
      </div>
    </div>
  );
}

function DocumentCard({
  title,
  tone,
  lines,
}: {
  title: string;
  tone: string;
  lines: readonly string[];
}) {
  return (
    <article className={`document-card ${tone}`}>
      <h3>{title}</h3>
      <div className="document-lines">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </article>
  );
}

type IconName =
  | "plus"
  | "spark"
  | "docs"
  | "tasks"
  | "calendar"
  | "journal"
  | "ideas"
  | "folder"
  | "back"
  | "forward"
  | "search"
  | "bell"
  | "grid"
  | "list"
  | "sort"
  | "chevron";

function UiIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    spark: <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />,
    docs: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    tasks: <><circle cx="7" cy="7" r="1.5" /><circle cx="7" cy="12" r="1.5" /><circle cx="7" cy="17" r="1.5" /><path d="M11 7h7M11 12h7M11 17h7" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
    journal: <><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2H19v17H8.5A2.5 2.5 0 0 0 6 21V4.5Z" /><path d="M6 4.5V21M10 7h5M10 11h5" /></>,
    ideas: <><path d="M9 18h6M10 21h4" /><path d="M8.5 14.5a6 6 0 1 1 7 0c-.9.6-1.5 1.4-1.5 2.5h-4c0-1.1-.6-1.9-1.5-2.5Z" /></>,
    folder: <><path d="M3.5 7.5h6l1.8 2H20.5v9.5h-17Z" /><path d="M3.5 7.5V5h6l1.8 2" /></>,
    back: <path d="m14.5 6-6 6 6 6" />,
    forward: <path d="m9.5 6 6 6-6 6" />,
    search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
    bell: <><path d="M6 16h12l-1.5-2v-3.5a4.5 4.5 0 0 0-9 0V14L6 16Z" /><path d="M10 19h4" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    list: <><path d="M8 6h11M8 12h11M8 18h11" /><circle cx="4.5" cy="6" r=".7" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r=".7" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r=".7" fill="currentColor" stroke="none" /></>,
    sort: <><path d="M8 5v14M5 8l3-3 3 3M16 19V5M13 16l3 3 3-3" /></>,
    chevron: <path d="m9 10 3 3 3-3" />,
  };

  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function AppWindow() {
  return (
    <div className="media-frame" aria-label="LearnSpace dashboard preview">
      <aside className="window-sidebar">
        <div className="mac-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <a className="sidebar-item new-doc" href="#hero">
          <span className="sidebar-icon"><UiIcon name="plus" /></span>
          New Note
        </a>
        <div className="space-row">
          <span className="space-icon"><UiIcon name="spark" /></span>
          <strong>LearnSpace</strong>
          <span className="space-chevron"><UiIcon name="chevron" /></span>
        </div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          <a className="sidebar-item selected" href="#hero">
            <span className="sidebar-icon"><UiIcon name="docs" /></span>
            All Notes
          </a>
          <a className="sidebar-item" href="#hero">
            <span className="sidebar-icon"><UiIcon name="tasks" /></span>
            Study Plan
          </a>
          <a className="sidebar-item" href="#hero">
            <span className="sidebar-icon"><UiIcon name="calendar" /></span>
            Calendar
          </a>
        </nav>
        <p className="sidebar-heading">Library</p>
        <a className="sidebar-item" href="#hero">
          <span className="sidebar-icon paper-icon"><UiIcon name="journal" /></span>
          Research Log
        </a>
        <a className="sidebar-item" href="#hero">
          <span className="sidebar-icon paper-icon"><UiIcon name="ideas" /></span>
          Course Notes
        </a>
        <p className="sidebar-heading folders-heading">Collections</p>
        <a className="sidebar-item" href="#hero">
          <span className="sidebar-icon"><UiIcon name="folder" /></span>
          Learning Paths
        </a>
      </aside>

      <section className="window-main">
        <div className="window-toolbar">
          <button className="toolbar-back" type="button" aria-label="Back">
            <UiIcon name="back" />
          </button>
          <button className="toolbar-forward" type="button" aria-label="Forward">
            <UiIcon name="forward" />
          </button>
          <div className="toolbar-space-name">
            <span className="toolbar-space-icon"><UiIcon name="spark" /></span>
            LearnSpace
          </div>
          <button className="toolbar-add" type="button" aria-label="Create document">
            <UiIcon name="plus" />
          </button>
          <div className="toolbar-tools" aria-hidden="true">
            <UiIcon name="search" />
            <UiIcon name="bell" />
            <span className="avatar">J</span>
          </div>
        </div>
        <div className="window-content">
          <div className="docs-heading">
            <div className="docs-title">
              <span className="docs-plus"><UiIcon name="plus" /></span>
              <h2>My Learning</h2>
            </div>
            <div className="view-tools" aria-hidden="true">
              <span className="view-active"><UiIcon name="grid" /></span>
              <UiIcon name="grid" />
              <UiIcon name="list" />
              <UiIcon name="sort" />
            </div>
          </div>
          <div className="document-grid">
            {documentCards.map((card) => (
              <DocumentCard key={card.title} {...card} />
            ))}
          </div>
          <div className="document-grid second-row" aria-hidden="true">
            <div className="document-card blue-card">
              <h3>Learning Map</h3>
              <div className="fake-paragraph" />
              <div className="fake-paragraph short" />
            </div>
            <div className="document-card blue-card pale-blue">
              <h3>Flashcards</h3>
              <div className="fake-paragraph" />
              <div className="fake-paragraph short" />
            </div>
            <div className="document-card blue-card dark-blue">
              <h3>Review Queue</h3>
              <div className="fake-paragraph" />
            </div>
            <div className="document-card green-card">
              <h3>Ideas</h3>
              <div className="fake-paragraph" />
            </div>
          </div>
        </div>
      </section>
      <button className="play-control" type="button" aria-label="Play product preview">
        <span />
      </button>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="hero" aria-labelledby="hero-title">
      <PaperCollage />
      <Navigation />
      <div className="hero-copy">
        <h1 id="hero-title">
          <span>Your space to learn,</span>
          <span>research, and remember.</span>
        </h1>
        <a className="hero-cta" href="#hero">
          Start Learning
        </a>
      </div>
      <AppWindow />
    </section>
  );
}

function App() {
  return (
    <main className="page">
      <Hero />
    </main>
  );
}

const mount = document.querySelector<HTMLDivElement>("#app");

if (!mount) {
  throw new Error("App mount not found");
}

createRoot(mount).render(<App />);
