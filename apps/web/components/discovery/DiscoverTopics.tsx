"use client";

import Link from "next/link";
import { ArrowRight, SquareTerminal, ChartScatter, BrainCircuit, ShieldCheck, Bot, Cpu, Newspaper, Orbit, DraftingCompass, Atom, Dna, FlaskConical, Globe2, PencilLine, Landmark, Languages, HeartPulse, Flower2, Sprout, Microscope, Store, Rocket, Coins, Scale, Megaphone, Laptop, FileUser, MessagesSquare, Award, Handshake, Presentation, Timer, PenTool, Wrench, Lightbulb, Brain, BadgeHelp, Heart, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";

type TopicSection = {
  name: string;
  slug: string;
  tone: number;
  categories: { slug: string; name: string; count: number; index: number }[];
};

const coverTitles: Record<string, string> = {
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

export function DiscoverTopics({ sections }: { sections: TopicSection[] }) {
  return (
    <div className="discover-topic-catalog">
      {sections.map((section) => (
        <section className="discover-category-section" key={section.slug} aria-label={section.name}>
          <div className="discover-category-grid">
            {section.categories.map((category) => (
              <Link className="discover-category-card" href={`/app/discover/${category.slug}`} key={category.slug} aria-label={`${category.name}, ${category.count} resources`} data-tone={section.tone}>
                <span className="discover-category-art" aria-hidden="true"><span className="discover-cover-label">{category.name}</span><strong className="discover-cover-title">{coverTitles[category.slug] ?? category.name}</strong><CoverArtwork categorySlug={category.slug} /><span className="discover-cover-edition">LS / {String(category.index + 1).padStart(2, "0")}</span></span>
                <span className="discover-category-details"><span className="discover-category-copy"><small>{category.count} resources <span aria-hidden="true">·</span> Curated collection</small></span><span className="discover-category-arrow"><ArrowRight aria-hidden="true" /></span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
