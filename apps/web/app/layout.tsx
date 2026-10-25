import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";
import "../styles/marketing.css";
import "../styles/auth.css";
import "../styles/application.css";
import "../styles/home.css";
import "../styles/discover.css";
import "../styles/source-discovery.css";
import "../styles/product.css";
import "../styles/study.css";
import "../styles/onboarding.css";

const appFont = localFont({
  src: "../public/fonts/InterVariable.woff2",
  weight: "100 900",
  variable: "--font-app",
  display: "optional",
  preload: true,
});

const geistFont = localFont({
  src: "../public/fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "optional",
  preload: false,
});

// Home's display and text face; only pages that use it download it.
const homeFont = localFont({
  src: "../public/fonts/PlusJakartaSans-Variable.woff2",
  weight: "200 800",
  variable: "--font-home",
  display: "swap",
  preload: false,
});

const editorialFont = localFont({
  src: "../node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-editorial",
  display: "optional",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: "LearnSpace — Your space to learn, research, and remember.",
  description: "Your space to learn, research, and remember.",
  icons: {
    icon: "/assets/learnspace-monogram.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${appFont.variable} ${geistFont.variable} ${homeFont.variable} ${editorialFont.variable}`} data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
