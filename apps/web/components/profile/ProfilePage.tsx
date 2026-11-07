import { CircleHelp, Flame, Lock, Settings, Trophy } from "lucide-react";
import Link from "next/link";
import { formatLearningDuration } from "../../lib/home/duration";
import { ACTIVITIES, LEVEL_XP, RANKS, STREAK_BONUS_XP, XP_RULES } from "../../lib/plan/levels";
import type { LearnerProfile } from "../../lib/profile/service";
import { Medal } from "../home/HomeCards";
import { LogoutButton } from "./LogoutButton";

type ProfileUser = { displayName: string | null; email: string; createdAt: string };

const levels = (rank: number) => Array.from({ length: 5 }, (_, index) => rank * 5 + index + 1);

export function ProfilePage({ user, profile }: { user: ProfileUser; profile: LearnerProfile }) {
  const { progression, stats, achievements, timezone } = profile;
  const { xp, level, rank, levelXp, nextLevelXp, streak, earned } = progression;
  const name = user.displayName?.trim() || user.email.split("@")[0]!;
  const percent = nextLevelXp === null ? 100 : Math.round((xp - levelXp) / (nextLevelXp - levelXp) * 100);
  const nextRank = RANKS[RANKS.indexOf(rank) + 1];
  const nextRankXp = nextRank ? LEVEL_XP[(RANKS.indexOf(rank) + 1) * 5]! : null;
  const since = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: timezone }).format(new Date(user.createdAt));
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;

  return <main className="home-page profile-page" aria-label="My profile">
    <section className="home-card profile-hero" aria-label="Account">
      <span className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <div className="profile-identity">
        <h1>{name}</h1>
        <p>{user.email}</p>
        <p>Learning since {since} · {timezone}</p>
      </div>
      <div className="profile-account">
        <Link className="plan-button" href="/app/settings"><Settings aria-hidden="true" />Settings</Link>
        <Link className="plan-button" href="/#how-it-works"><CircleHelp aria-hidden="true" />Help</Link>
        <LogoutButton />
      </div>
    </section>

    <section className="home-card home-level profile-standing" aria-label="Where you stand">
      <header className="home-card-head"><h2>Where you stand</h2><span className={`home-streak${streak > 0 ? " is-live" : ""}`} title="Days in a row with study"><Flame aria-hidden="true" />{streak}-day streak</span></header>
      <div className="home-level-hero">
        <Medal rank={rank} size={88} />
        <div>
          <p className="home-level-rank">{rank}</p>
          <h3>Level {level}</h3>
          <p className="home-level-xp"><b>{xp.toLocaleString("en")}</b> XP total{nextRankXp === null ? "" : ` · ${(nextRankXp - xp).toLocaleString("en")} XP to ${nextRank}`}</p>
        </div>
      </div>
      <div className="home-level-progress">
        <div><span>{nextLevelXp === null ? "Max level reached" : `${(nextLevelXp - xp).toLocaleString("en")} XP to Level ${level + 1}`}</span><span>{percent}%</span></div>
        <span className="home-meter is-xp" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><i style={{ width: `${percent}%` }} /></span>
      </div>
      <ol className="profile-track" aria-label="Levels">{RANKS.map((name, index) => <li key={name} className={RANKS.indexOf(rank) < index ? "is-ahead" : ""}>
        <span className="profile-track-rank"><Medal rank={name} size={22} dim={RANKS.indexOf(rank) < index} />{name}</span>
        <ol>{levels(index).map((step) => <li key={step} className={step < level ? "is-past" : step === level ? "is-current" : ""} aria-current={step === level ? "step" : undefined} title={`Level ${step}: ${LEVEL_XP[step - 1]!.toLocaleString("en")} XP`}>{step}</li>)}</ol>
      </li>)}</ol>
    </section>

    <section className="home-card" aria-label="Stats">
      <header className="home-card-head"><h2>Stats</h2></header>
      <dl className="profile-stats">
        <div><dt>Focus time</dt><dd>{formatLearningDuration(stats.focusMinutes * 60)}</dd></div>
        <div><dt>Lessons finished</dt><dd>{stats.lessonsFinished}</dd></div>
        <div><dt>Plan items completed</dt><dd>{Number(stats.planDone.toFixed(1))}</dd></div>
        <div><dt>Active days</dt><dd>{stats.activeDays}</dd></div>
        <div><dt>Current streak</dt><dd>{streak} {streak === 1 ? "day" : "days"}</dd></div>
        <div><dt>Longest streak</dt><dd>{stats.longestStreak} {stats.longestStreak === 1 ? "day" : "days"}</dd></div>
        <div><dt>Questions asked</dt><dd>{stats.questions}</dd></div>
      </dl>
    </section>

    <section className="home-card profile-xp" id="xp" aria-label="How you earn XP">
      <header className="home-card-head"><h2>How you earn XP</h2><span className="profile-count">Counted from what you actually study</span></header>
      <table>
        <thead><tr><th scope="col">Activity</th><th scope="col">Points</th><th scope="col">You earned</th></tr></thead>
        <tbody>
          {ACTIVITIES.map((activity) => {
            const rule = XP_RULES[activity];
            return <tr key={activity}><th scope="row">{rule.label}</th><td>{rule.xp} XP per {rule.per}{rule.dailyCap ? `, first ${rule.dailyCap} a day` : ""}</td><td>{earned[activity].toLocaleString("en")} XP</td></tr>;
          })}
          <tr><th scope="row">Keep your streak</th><td>{STREAK_BONUS_XP} XP for each day that continues it</td><td>{earned.streak.toLocaleString("en")} XP</td></tr>
        </tbody>
      </table>
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
