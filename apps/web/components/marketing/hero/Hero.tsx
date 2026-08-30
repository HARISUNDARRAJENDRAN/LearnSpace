import { HeroCollage } from "./HeroCollage";
import { HeroNavigation } from "./HeroNavigation";
import { HeroProductPreview } from "./HeroProductPreview";

export function Hero() {
  return (
    <section className="hero" id="hero" aria-labelledby="hero-title">
      <HeroCollage />
      <HeroNavigation />
      <div className="hero-copy">
        <h1 id="hero-title">
          <span>Your space to learn,</span>
          <span>research, and remember.</span>
        </h1>
        <a className="hero-cta" href="/register">
          Start Learning
        </a>
      </div>
      <HeroProductPreview />
    </section>
  );
}
