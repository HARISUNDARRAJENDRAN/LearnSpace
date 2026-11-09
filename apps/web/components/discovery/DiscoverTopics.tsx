"use client";

import Link from "next/link";
import { useRef } from "react";
import { scrollToElement } from "../application/SmoothScroll";
import { ArrowLeft, ArrowRight, Activity, Banknote, Beaker, Binary, Bone, BookOpenText, Calculator, ChartLine, ChartPie, CircuitBoard, Cog, Component, Database, Dices, FileCode, Gauge, GraduationCap, Hexagon, Infinity as InfinityIcon, KeyRound, Layers, Magnet, Network, Puzzle, Radical, Receipt, Route, Ruler, ScrollText, Server, Sigma, SpellCheck, SquareFunction, Stethoscope, Swords, Tally5, TestTubes, Thermometer, ToggleLeft, Triangle, Variable, Vote, Waves, Waypoints, Weight, Workflow, Earth, Brackets, MessageSquareText, Spline, SquareTerminal, ChartScatter, BrainCircuit, ShieldCheck, Bot, Cpu, Newspaper, Orbit, DraftingCompass, Atom, Dna, FlaskConical, Globe2, PencilLine, Landmark, Languages, HeartPulse, Flower2, Sprout, Microscope, Store, Rocket, Coins, Scale, Megaphone, Laptop, FileUser, MessagesSquare, Award, Handshake, Presentation, Timer, PenTool, Wrench, Lightbulb, Brain, BadgeHelp, Heart, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";

type TopicSection = {
  name: string;
  slug: string;
  tone: number;
  categories: { slug: string; name: string; count: number }[];
};

const coverTitles: Record<string, string> = {
  "school-algebra-1": "Solve for x.",
  "school-geometry": "Prove it.",
  "school-algebra-2-trig": "Functions everywhere.",
  "school-precalculus": "Ready for calculus.",
  "school-ap-calculus": "Change, measured.",
  "school-statistics": "Read the data.",
  "school-physics": "How things move.",
  "school-chemistry": "Mix with care.",
  "school-biology": "The study of life.",
  "school-earth-environmental": "Our living planet.",
  "school-computer-science": "Your first programs.",
  "school-world-history": "How we got here.",
  "school-us-history-government": "We the people.",
  "school-english-grammar-writing": "Write it well.",
  "school-literature": "Read between the lines.",
  "school-economics": "Supply meets demand.",
  "exam-sat": "Test day, ready.",
  "exam-jee-main": "Crack the concepts.",
  "exam-neet": "Every mark counts.",
  "exam-ielts-toefl": "Speak with confidence.",
  "univ-calculus-1": "Limits to integrals.",
  "univ-calculus-2-3": "More dimensions.",
  "univ-linear-algebra": "Think in vectors.",
  "univ-differential-equations": "Model the world.",
  "univ-discrete-math": "Logic, counted.",
  "univ-probability": "Embrace uncertainty.",
  "univ-real-analysis": "Rigor, step by step.",
  "univ-abstract-algebra": "Structure is everything.",
  "univ-intro-programming": "Hello, world.",
  "univ-data-structures-algorithms": "Solve it faster.",
  "univ-computer-architecture": "Inside the machine.",
  "univ-operating-systems": "Under the hood.",
  "univ-computer-networks": "Packets in motion.",
  "univ-databases": "Query anything.",
  "univ-theory-of-computation": "What can be computed.",
  "univ-compilers": "Code into code.",
  "univ-machine-learning": "Learn from data.",
  "univ-deep-learning": "Layers of insight.",
  "univ-nlp": "Machines that read.",
  "univ-distributed-systems": "Many machines, one system.",
  "univ-software-engineering": "Build it right.",
  "univ-cryptography": "Keep it secret.",
  "univ-classical-mechanics": "Force and motion.",
  "univ-electromagnetism": "Fields and waves.",
  "univ-quantum-mechanics": "Small and strange.",
  "univ-thermo-stat-mech": "Heat, by the numbers.",
  "univ-general-chemistry": "Atoms to reactions.",
  "univ-organic-chemistry": "Carbon’s many shapes.",
  "univ-physical-chemistry": "Chemistry, quantified.",
  "univ-cell-molecular-biology": "Life’s machinery.",
  "univ-genetics": "Written in genes.",
  "univ-biochemistry": "The chemistry of life.",
  "univ-neuroscience": "How the brain works.",
  "univ-anatomy-physiology": "The human body.",
  "univ-circuit-analysis": "Follow the current.",
  "univ-digital-logic": "Ones and zeros.",
  "univ-signals-systems": "Hear the signal.",
  "univ-control-systems": "Stay in control.",
  "univ-engineering-mechanics": "Balance the forces.",
  "univ-microeconomics": "Choices at the margin.",
  "univ-macroeconomics": "Whole economies.",
  "univ-game-theory": "Think strategically.",
  "univ-financial-accounting": "Read the books.",
  "univ-corporate-finance": "What is it worth?",
  "coding-programming": "Think in code.",
  "data-science-ai": "Find the pattern.",
  "ai-innovation": "Imagine what’s next.",
  cybersecurity: "Stay one step ahead.",
  "robotics-iot": "Make it move.",
  "electronics-arduino": "Spark an idea.",
  "tech-news": "Keep looking forward.",
  "space-future-tech": "Beyond the ordinary.",
  mathematics: "It all adds up.",
  physics: "Question everything.",
  biology: "Life, up close.",
  chemistry: "A little chemistry.",
  geography: "A world to discover.",
  "science-experiments": "What happens if…",
  entrepreneurship: "Start something.",
  startups: "From zero to one.",
  "financial-literacy": "Make money make sense.",
  economics: "See the bigger picture.",
  "digital-marketing": "Get the word out.",
  "freelancing-remote": "Work on your terms.",
  "resume-job-hunting": "Your next chapter.",
  "interview-preparation": "Show up ready.",
  certifications: "Keep moving up.",
  "soft-skills": "The human side.",
  "public-speaking": "Find your voice.",
  productivity: "Make room for more.",
  design: "Make good things.",
  "writing-content": "Words with purpose.",
  "diy-projects": "Made by you.",
  "history-civics": "The stories before us.",
  philosophy: "A different perspective.",
  psychology: "Inside the mind.",
  "language-learning": "Say something new.",
  "trivia-facts": "Stay curious.",
  "health-fitness": "Feel a little stronger.",
  "mental-wellness": "Space to breathe.",
  "sustainable-living": "Small steps. Better world.",
};

const coverArtwork: Record<string, LucideIcon> = {
  "school-algebra-1": Variable,
  "school-geometry": Triangle,
  "school-algebra-2-trig": SquareFunction,
  "school-precalculus": Spline,
  "school-ap-calculus": InfinityIcon,
  "school-statistics": ChartPie,
  "school-physics": Magnet,
  "school-chemistry": TestTubes,
  "school-biology": Dna,
  "school-earth-environmental": Earth,
  "school-computer-science": SquareTerminal,
  "school-world-history": ScrollText,
  "school-us-history-government": Vote,
  "school-english-grammar-writing": SpellCheck,
  "school-literature": BookOpenText,
  "school-economics": ChartLine,
  "exam-sat": GraduationCap,
  "exam-jee-main": Calculator,
  "exam-neet": Stethoscope,
  "exam-ielts-toefl": MessageSquareText,
  "univ-calculus-1": Sigma,
  "univ-calculus-2-3": Layers,
  "univ-linear-algebra": Ruler,
  "univ-differential-equations": Waves,
  "univ-discrete-math": Tally5,
  "univ-probability": Dices,
  "univ-real-analysis": Radical,
  "univ-abstract-algebra": Hexagon,
  "univ-intro-programming": Brackets,
  "univ-data-structures-algorithms": Workflow,
  "univ-computer-architecture": CircuitBoard,
  "univ-operating-systems": Server,
  "univ-computer-networks": Network,
  "univ-databases": Database,
  "univ-theory-of-computation": Binary,
  "univ-compilers": FileCode,
  "univ-machine-learning": ChartScatter,
  "univ-deep-learning": BrainCircuit,
  "univ-nlp": Languages,
  "univ-distributed-systems": Waypoints,
  "univ-software-engineering": Component,
  "univ-cryptography": KeyRound,
  "univ-classical-mechanics": Weight,
  "univ-electromagnetism": Magnet,
  "univ-quantum-mechanics": Atom,
  "univ-thermo-stat-mech": Thermometer,
  "univ-general-chemistry": FlaskConical,
  "univ-organic-chemistry": Beaker,
  "univ-physical-chemistry": Activity,
  "univ-cell-molecular-biology": Microscope,
  "univ-genetics": Dna,
  "univ-biochemistry": Puzzle,
  "univ-neuroscience": Brain,
  "univ-anatomy-physiology": Bone,
  "univ-circuit-analysis": Cpu,
  "univ-digital-logic": ToggleLeft,
  "univ-signals-systems": Route,
  "univ-control-systems": Gauge,
  "univ-engineering-mechanics": Cog,
  "univ-microeconomics": Scale,
  "univ-macroeconomics": Landmark,
  "univ-game-theory": Swords,
  "univ-financial-accounting": Receipt,
  "univ-corporate-finance": Banknote,
  "coding-programming": SquareTerminal,
  "data-science-ai": ChartScatter,
  "ai-innovation": BrainCircuit,
  "cybersecurity": ShieldCheck,
  "robotics-iot": Bot,
  "electronics-arduino": Cpu,
  "tech-news": Newspaper,
  "space-future-tech": Orbit,
  "mathematics": DraftingCompass,
  "physics": Atom,
  "biology": Dna,
  "chemistry": FlaskConical,
  "geography": Globe2,
  "writing-content": PencilLine,
  "history-civics": Landmark,
  "language-learning": Languages,
  "health-fitness": HeartPulse,
  "mental-wellness": Flower2,
  "sustainable-living": Sprout,
  "science-experiments": Microscope,
  "entrepreneurship": Store,
  "startups": Rocket,
  "financial-literacy": Coins,
  "economics": Scale,
  "digital-marketing": Megaphone,
  "freelancing-remote": Laptop,
  "resume-job-hunting": FileUser,
  "interview-preparation": MessagesSquare,
  "certifications": Award,
  "soft-skills": Handshake,
  "public-speaking": Presentation,
  "productivity": Timer,
  "design": PenTool,
  "diy-projects": Wrench,
  "philosophy": Lightbulb,
  "psychology": Brain,
  "trivia-facts": BadgeHelp,
  "based-on-interests": Heart,
  "recommended-for-you": Sparkles,
  "trending-now": TrendingUp,
};

function CoverArtwork({ categorySlug }: { categorySlug: string }) {
  const Illustration = coverArtwork[categorySlug] ?? DraftingCompass;
  const stickerShapes = [
    "M60 14C85 8 108 29 104 54C114 80 92 108 65 104C37 113 12 91 16 66C8 38 32 9 60 14Z",
    "M35 15H85C98 15 105 22 105 35V85C105 98 98 105 85 105H35C22 105 15 98 15 85V35C15 22 22 15 35 15Z",
    "M60 12C72 12 75 23 85 26C96 29 108 33 108 46C108 57 98 62 97 72C96 85 95 99 82 103C70 107 63 97 53 98C40 100 27 105 19 93C12 83 20 73 18 63C15 51 7 40 16 30C24 21 36 26 45 21C51 17 52 12 60 12Z",
  ];
  const sticker = stickerShapes[categorySlug.length % stickerShapes.length];
  return (
    <svg className="discover-cover-illustration" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d={sticker} transform="translate(3 4)" fill="currentColor" opacity=".12" />
      <path d={sticker} fill="var(--cover-accent)" stroke="currentColor" strokeWidth="1.25" />
      <Illustration x="28" y="28" width="64" height="64" strokeWidth={1.5} />
      <g className="discover-cover-doodles" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m101 8 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="var(--cover-bg)" />
        <path d="m8 92-4 3 M13 102l-2 5" />
        <circle cx="101" cy="102" r="3" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
}

function CategoryCard({ category, tone }: { category: TopicSection["categories"][number]; tone: number }) {
  return (
    <Link className="discover-category-card" href={`/app/discover/${category.slug}`} aria-label={`${category.name}, ${category.count} resources`} data-tone={tone}>
      <span className="discover-category-art" aria-hidden="true"><span className="discover-cover-label">{category.name}</span><strong className="discover-cover-title">{coverTitles[category.slug] ?? category.name}</strong><CoverArtwork categorySlug={category.slug} /></span>
      <span className="discover-category-details"><span className="discover-category-copy"><small>{category.count} resources <span aria-hidden="true">·</span> Curated collection</small></span><span className="discover-category-arrow"><ArrowRight aria-hidden="true" /></span></span>
    </Link>
  );
}

function Shelf({ section }: { section: TopicSection }) {
  const shelf = useRef<HTMLDivElement>(null);
  // One page of cards per press, so mouse users are not left with only a thin scrollbar.
  const page = (direction: 1 | -1) => {
    const element = shelf.current;
    // A page is the visible cards plus the gap after them, so each press lands on a card edge.
    if (element) element.scrollBy({ left: direction * (element.clientWidth + Number.parseFloat(getComputedStyle(element).columnGap)), behavior: "smooth" });
  };
  return (
    <section className="discover-category-section" id={`area-${section.slug}`} aria-labelledby={`area-${section.slug}-heading`}>
      <div className="discovery-section-heading">
        <div><h2 id={`area-${section.slug}-heading`}>{section.name}</h2><p className="discover-recommendation-context">{section.categories.length} {section.categories.length === 1 ? "collection" : "collections"}</p></div>
        <div className="discover-shelf-controls">
          <button type="button" onClick={() => page(-1)} aria-label={`Previous ${section.name} collections`}><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => page(1)} aria-label={`More ${section.name} collections`}><ArrowRight aria-hidden="true" /></button>
          <Link href={`/app/discover?area=${section.slug}`} className="discover-shelf-all" aria-label={`View all ${section.name}`}>View all</Link>
        </div>
      </div>
      <div ref={shelf} className="discover-category-grid discover-category-shelf">
        {section.categories.map((category) => <CategoryCard key={category.slug} category={category} tone={section.tone} />)}
      </div>
    </section>
  );
}

// The landing shows each area as a scrolling shelf; an area's own page shows its full grid.
export function DiscoverTopics({ sections, shelves }: { sections: TopicSection[]; shelves: boolean }) {
  return (
    <div className="discover-topic-catalog">
      {shelves && sections.length > 1 ? (
        <nav className="discover-area-nav" aria-label="Subject areas">
          {sections.map((section) => <button key={section.slug} type="button" onClick={() => { const target = document.getElementById(`area-${section.slug}`); if (target) scrollToElement(target); }}>{section.name}</button>)}
        </nav>
      ) : null}
      {shelves ? sections.map((section) => <Shelf key={section.slug} section={section} />) : sections.map((section) => (
        <section className="discover-category-section" id={`area-${section.slug}`} key={section.slug} aria-labelledby={`area-${section.slug}-heading`}>
          <div className="discovery-section-heading">
            <div><h2 id={`area-${section.slug}-heading`}>{section.name}</h2><p className="discover-recommendation-context">{section.categories.length} {section.categories.length === 1 ? "collection" : "collections"}</p></div>
          </div>
          <div className="discover-category-grid">
            {section.categories.map((category) => <CategoryCard key={category.slug} category={category} tone={section.tone} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
