import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/source-serif-4/400.css";
import "./globals.css";
import "../styles/marketing.css";
import "../styles/auth.css";
import "../styles/application.css";
import "../styles/home.css";
import "../styles/source-discovery.css";
import "../styles/product.css";
import "../styles/study.css";
import "../styles/onboarding.css";

export const metadata: Metadata = {
  title: "LearnSpace — Your space to learn, research, and remember.",
  description: "Your space to learn, research, and remember.",
  icons: {
    icon: "/assets/learnspace-monogram.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
