import { LearnSpaceLogo } from "./LearnSpaceLogo";

const navigation = ["Features", "Community", "Pricing", "Learn"] as const;

export function HeroNavigation() {
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
        <a className="nav-cta" href="/login">
          Login
        </a>
      </div>
    </header>
  );
}
