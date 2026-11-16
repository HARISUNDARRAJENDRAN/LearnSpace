import { AlarmClock, Check, CircleHelp, Clock3, Flame, Lock, MessageCircle, Settings, Target, Trophy } from "lucide-react";
import Link from "next/link";
import { formatLearningDuration } from "../../lib/home/duration";
import { LEVEL_XP, RANKS, STREAK_BONUS_XP, XP_RULES } from "../../lib/plan/levels";
import type { LearnerProfile } from "../../lib/profile/service";
import { Medal } from "../home/HomeCards";
import { LogoutButton } from "./LogoutButton";

type ProfileUser = { displayName: string | null; email: string; createdAt: string };

const levels = (rank: number) => Array.from({ length: 5 }, (_, index) => rank * 5 + index + 1);
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

// Each group borrows the plan calendar's kind palette.
const xpGroups = [
  { label: "Time well spent", icon: Clock3, tone: "read", activities: ["watch", "read"] as const },
  { label: "Finish what you start", icon: Check, tone: "watch", activities: ["finish_video", "finish_paper"] as const },
  { label: "Stay curious", icon: MessageCircle, tone: "review", activities: ["question"] as const },
  { label: "Follow your plan", icon: Target, tone: "practice", activities: ["plan_watch", "plan_read", "plan_practice", "plan_review"] as const },
  { label: "Keep to your schedule", icon: AlarmClock, tone: "watch", activities: ["on_time", "in_slot", "day_plan"] as const },
];

export function ProfilePage({ user, profile }: { user: ProfileUser; profile: LearnerProfile }) {
  const { progression, stats, achievements, timezone } = profile;
  const { xp, level, rank, levelXp, nextLevelXp, weekXp, todayXp, streak, earned } = progression;
  const name = user.displayName?.trim() || user.email.split("@")[0]!;
  const percent = nextLevelXp === null ? 100 : Math.round((xp - levelXp) / (nextLevelXp - levelXp) * 100);
  const rankIndex = RANKS.indexOf(rank);
  const nextRank = RANKS[rankIndex + 1];
  const since = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: timezone }).format(new Date(user.createdAt));
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;

  return <main className="home-page profile-page" aria-label="My profile">
    <section className="home-card profile-account" aria-label="Account">
      <span className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <div className="profile-identity">
        <h2>{name}</h2>
        <p>{user.email}</p>
        <p>Learning since {since} · {timezone}</p>
      </div>
      <div className="profile-actions">
        <Link className="plan-button" href="/app/settings"><Settings aria-hidden="true" />Settings</Link>
        <Link className="plan-button" href="/#how-it-works"><CircleHelp aria-hidden="true" />Help</Link>
        <LogoutButton />
      </div>
    </section>

    <div className="profile-row">
      <section className="home-card home-level" aria-label="Level & rank">
        <header className="home-card-head"><h2>Level & rank</h2><span className={`home-streak${streak > 0 ? " is-live" : ""}`} title="Days in a row with study"><Flame aria-hidden="true" />{streak}-day streak</span></header>
        <div className="profile-level-summary">
          <div className="home-level-hero">
            <Medal rank={rank} size={72} />
            <div>
              <p className="home-level-rank">{rank}</p>
              <h3>Level {level}</h3>
              <p className="home-level-xp"><b>{xp.toLocaleString("en")}</b> XP total{nextRank ? ` · ${(LEVEL_XP[(rankIndex + 1) * 5]! - xp).toLocaleString("en")} XP to ${nextRank}` : ""}</p>
            </div>
          </div>
          <dl className="home-level-stats">
            <div><dt>Today</dt><dd>+{todayXp.toLocaleString("en")}</dd></div>
            <div><dt>Last 7 days</dt><dd>+{weekXp.toLocaleString("en")}</dd></div>
            <div><dt>Streak bonus</dt><dd>{earned.streak.toLocaleString("en")}</dd></div>
          </dl>
        </div>
        <div className="home-level-progress">
          <div><span>{nextLevelXp === null ? "Max level reached" : `${(nextLevelXp - xp).toLocaleString("en")} XP to Level ${level + 1}`}</span><span>{percent}%</span></div>
          <span className="home-meter is-xp" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><i style={{ width: `${percent}%` }} /></span>
        </div>
        <ol className="profile-track" aria-label="Levels">{RANKS.map((name, index) => <li key={name} className={rankIndex < index ? "is-ahead" : ""}>
          <span className="profile-track-rank"><Medal rank={name} size={20} dim={rankIndex < index} />{name}</span>
          <ol>{levels(index).map((step) => <li key={step} className={step < level ? "is-past" : step === level ? "is-current" : ""} aria-current={step === level ? "step" : undefined} title={`Level ${step}: ${LEVEL_XP[step - 1]!.toLocaleString("en")} XP`}>{step}</li>)}</ol>
        </li>)}</ol>
      </section>

      <section className="home-card" aria-label="Stats">
        <header className="home-card-head"><h2>Stats</h2><span className="profile-count">All time</span></header>
        <dl className="home-recent-stats profile-stats">
          <div><dt>Focus time</dt><dd>{formatLearningDuration(stats.focusMinutes * 60)}</dd></div>
          <div><dt>Lessons finished</dt><dd>{stats.lessonsFinished}</dd></div>
          <div><dt>Plan items completed</dt><dd>{Number(stats.planDone.toFixed(1))}</dd></div>
          <div><dt>Active days</dt><dd>{stats.activeDays}</dd></div>
          <div><dt>Longest streak</dt><dd>{days(stats.longestStreak)}</dd></div>
          <div><dt>Questions asked</dt><dd>{stats.questions}</dd></div>
        </dl>
      </section>
    </div>

    <section className="home-card" id="xp" aria-label="How you earn XP">
      <header className="home-card-head"><h2>How you earn XP</h2><span className="profile-count">Counted from what you actually study</span></header>
      <ul className="profile-xp">
        {xpGroups.map(({ label, icon: Icon, tone, activities }) => <li key={label} className={`kind-${tone}`}>
          <header><span className="profile-xp-icon"><Icon aria-hidden="true" /></span><h3>{label}</h3><b>{activities.reduce((total, activity) => total + earned[activity], 0).toLocaleString("en")} XP</b></header>
          <dl>{activities.map((activity) => {
            const rule = XP_RULES[activity];
            return <div key={activity}><dt>{rule.label}<small>{rule.xp} XP per {rule.per}{rule.dailyCap ? `, first ${rule.dailyCap} a day` : ""}</small></dt><dd>{earned[activity].toLocaleString("en")}</dd></div>;
          })}</dl>
        </li>)}
        <li className="profile-xp-streak">
          <header><span className="profile-xp-icon"><Flame aria-hidden="true" /></span><h3>Keep your streak</h3><b>{earned.streak.toLocaleString("en")} XP</b></header>
          <dl><div><dt>Each day that continues it<small>{STREAK_BONUS_XP} XP per day</small></dt><dd>{earned.streak.toLocaleString("en")}</dd></div></dl>
        </li>
      </ul>
      <p className="home-card-foot">Plan items complete as you study, and a partly done item earns its share of the points. Achievements are milestones and do not add XP.</p>
    </section>

    <section className="home-card" aria-label="Achievements">
      <header className="home-card-head"><h2>Achievements</h2><span className="profile-count">{unlocked} of {achievements.length} unlocked</span></header>
      <ul className="profile-achievements">{achievements.map((achievement) => <li key={achievement.id} className={achievement.unlocked ? "is-unlocked" : ""}>
        <span className="profile-achievement-icon" aria-hidden="true">{achievement.unlocked ? <Trophy /> : <Lock />}</span>
        <div>
          <h3>{achievement.title}</h3>
          <p>{achievement.detail}</p>
          {achievement.unlocked ? <small>Unlocked</small> : <>
            <span className="home-meter" role="progressbar" aria-valuenow={achievement.value} aria-valuemin={0} aria-valuemax={achievement.target} aria-label={`${achievement.title} progress`}><i style={{ width: `${achievement.value / achievement.target * 100}%` }} /></span>
            <small>{Math.floor(achievement.value).toLocaleString("en")} / {achievement.target.toLocaleString("en")}</small>
          </>}
        </div>
      </li>)}</ul>
    </section>
  </main>;
}
