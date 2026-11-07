import { Features } from "../components/marketing/Features";
import { CtaBanner, Footer } from "../components/marketing/Footer";
import { Hero } from "../components/marketing/Hero";
import { Introduction } from "../components/marketing/Introduction";
import { MotionEffects } from "../components/marketing/MotionEffects";
import { Pricing } from "../components/marketing/Pricing";
import { SiteNav } from "../components/marketing/SiteNav";
import { UseCases } from "../components/marketing/UseCases";
import { getCurrentSession } from "../lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Page() {
	const authenticated = Boolean(await getCurrentSession());

	return (
		<main className="ls-landing">
			<MotionEffects />
			<SiteNav authenticated={authenticated} sticky />
			<Hero authenticated={authenticated} />
			<Introduction />
			<Features />
			<UseCases />
			<Pricing />
			<CtaBanner authenticated={authenticated} />
			<Footer />
		</main>
	);
}
