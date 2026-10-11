"use client";

import { useId, useState } from "react";
import type { ActivityPeriod, ActivityPoint } from "../../lib/home/analytics";
import { formatLearningDuration } from "../../lib/home/duration";

export function HomeActivity({ periods }: { periods: Record<ActivityPeriod, ActivityPoint[]> }) {
  const [period, setPeriod] = useState<ActivityPeriod>("This Week");
  const descriptionId = useId();
  const points = periods[period];
  const total = points.reduce((sum, point) => sum + point.seconds, 0);
  const recordedMaximum = Math.max(...points.map((point) => point.seconds));
  const unit = recordedMaximum >= 3600 ? 900 : 60;
  const maximum = recordedMaximum > 0 ? Math.ceil(recordedMaximum / unit) * unit : 3600;
  const step = 440 / points.length;
  return <section className="home-activity" aria-labelledby="home-activity-title">
    <div className="home-section-heading"><h2 id="home-activity-title">Your Learning Activity</h2>
      <select className="home-period-select" aria-label="Activity period" value={period} onChange={(event) => setPeriod(event.target.value as ActivityPeriod)}>{Object.keys(periods).map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <div className="home-activity-total" aria-live="polite"><strong>{(total / 3600).toFixed(1)}</strong><span>Hours spent</span><span className="sr-only">{formatLearningDuration(total)} recorded study time</span></div>
    <svg className="home-activity-chart" viewBox="0 0 500 128" role="img" aria-label={`${period}: ${formatLearningDuration(total)} recorded study time`} aria-describedby={descriptionId}>
      <desc id={descriptionId}>{points.map((point) => `${point.day}: ${formatLearningDuration(point.seconds)}`).join("; ")}</desc>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = 104 - tick * 21.75;
        return <g key={tick}><line x1="45" x2="488" y1={y} y2={y} /><text x="35" y={y + 4} textAnchor="end">{tick === 0 ? "0" : maximum >= 3600 ? `${(maximum / 3600 * tick / 4).toFixed(1)}h` : formatLearningDuration(maximum * tick / 4)}</text></g>;
      })}
      {points.map((point, index) => {
        const x = 47 + (index + .5) * step;
        const height = point.seconds / maximum * 87;
        return <g key={point.day}>
          {height > 0 ? <rect className="home-activity-bar" x={x - step * .27} y={104 - height} width={step * .54} height={height} rx="3"><title>{`${point.day}: ${formatLearningDuration(point.seconds)}`}</title></rect> : null}
          {points.length <= 7 || index % 5 === 0 || index === points.length - 1 ? <text x={x} y="124" textAnchor="middle">{point.label}</text> : null}
        </g>;
      })}
    </svg>
  </section>;
}
