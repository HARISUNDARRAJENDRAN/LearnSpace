import { Check } from "lucide-react";
import type { HomeData } from "../../lib/home/load";
import { createHomeAnalytics } from "../../lib/home/analytics";
import { HomeActivity } from "./HomeActivity";
import { ContinueLearning } from "./ContinueLearning";
import { HomeProgress } from "./HomeProgress";

export type HomeUser = { displayName: string | null; email: string };

export function HomeDashboard({ home, user }: HomeData & { user: HomeUser }) {
  const analytics = createHomeAnalytics(home);
  const name = user.displayName?.trim().split(/\s+/)[0];
  return <main className="home-dashboard" aria-label="Your learning Home">
    <div className="home-main-column">
      <section className="home-welcome" aria-labelledby="home-welcome-title">
        <h2 id="home-welcome-title">Welcome back{name ? `, ${name}` : ""}! <span aria-hidden="true">👋</span></h2>
        <p>Let’s continue your learning journey.</p>
      </section>
      <section className="home-statuses" aria-label="Session overview">
        <span><i className="home-status-completed"><Check aria-hidden="true" /></i><strong>{home.sessionCounts.completed}</strong> Completed</span>
        <span><i className="home-status-active">{home.sessionCounts.total - home.sessionCounts.completed}</i> In Progress</span>
        <span><i className="home-status-upcoming">0</i> Upcoming</span>
      </section>
      <HomeActivity periods={analytics.periods} />
      <ContinueLearning sessions={home.sessions} />
    </div>
    <HomeProgress counts={home.sessionCounts} seconds={analytics.seconds} completedLessons={analytics.completed} streak={analytics.streak} user={user} />
  </main>;
}
