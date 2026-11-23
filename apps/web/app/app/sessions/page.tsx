import type { Metadata } from "next";
import { SessionsDashboard } from "@/components/folders/SessionsDashboard";

export const metadata: Metadata = { title: "Sessions | LearnSpace" };

export default async function SessionsRoute({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  return <SessionsDashboard mode={(await searchParams).mode === "research" ? "research" : "learn"} />;
}
