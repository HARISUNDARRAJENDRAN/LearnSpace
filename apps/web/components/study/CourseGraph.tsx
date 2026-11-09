import type { StudyCourseLessonState, StudySessionCourse } from "@learnspace/shared";
import { Check, Lock } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export type CanvasRect = { x: number; y: number; width: number; height: number };

type Lesson = StudySessionCourse["sections"][number]["lessons"][number];
type PlacedLesson = { lesson: Lesson; number: number; x: number; y: number; row: number };
type Frame = { id: string; title: string; hue: number; x: number; y: number; width: number; height: number };

export const LESSON_WIDTH = 800;
export const LESSON_MEDIA_HEIGHT = 450;
const LESSON_HEIGHT = LESSON_MEDIA_HEIGHT + 96;
const COLUMNS = 3;
const GAP_X = 140;
const GAP_Y = 150;
const FRAME_PADDING = 64;
const FRAME_TITLE_HEIGHT = 110;
const SECTION_GAP = 220;
const SECTION_HUES = [8, 212, 145, 280, 38];

/**
 * Lays the course out as a board: each section is a tinted frame, and its lessons run in a snake,
 * left to right then right to left, so every lesson sits right beside the one it leads to.
 */
export function layoutCourse(course: StudySessionCourse) {
  const lessons: PlacedLesson[] = [];
  const frames: Frame[] = [];
  let top = 0;
  let number = 0;
  let row = 0;
  course.sections.forEach((section, sectionIndex) => {
    const columns = Math.min(COLUMNS, section.lessons.length);
    const rows = Math.ceil(section.lessons.length / COLUMNS);
    const width = columns * LESSON_WIDTH + (columns - 1) * GAP_X + FRAME_PADDING * 2;
    const height = rows * LESSON_HEIGHT + (rows - 1) * GAP_Y + FRAME_PADDING * 2;
    const frameTop = top + FRAME_TITLE_HEIGHT;
    frames.push({ id: section.id, title: section.title, hue: SECTION_HUES[sectionIndex % SECTION_HUES.length] ?? 212, x: -width / 2, y: frameTop, width, height });
    section.lessons.forEach((lesson, index) => {
      const sectionRow = Math.floor(index / COLUMNS);
      const step = index % COLUMNS;
      const column = sectionRow % 2 === 0 ? step : columns - 1 - step;
      number += 1;
      lessons.push({ lesson, number, row: row + sectionRow, x: -width / 2 + FRAME_PADDING + column * (LESSON_WIDTH + GAP_X), y: frameTop + FRAME_PADDING + sectionRow * (LESSON_HEIGHT + GAP_Y) });
    });
    row += rows;
    top = frameTop + height + SECTION_GAP;
  });
  const widest = Math.max(0, ...frames.map((frame) => frame.width));
  const bottom = Math.max(0, top - SECTION_GAP);
  // Centre the board on the world origin, where the canvas puts the viewport centre.
  const shiftY = -bottom / 2;
  for (const lesson of lessons) lesson.y += shiftY;
  for (const frame of frames) frame.y += shiftY;
  const bounds: CanvasRect = { x: -widest / 2, y: shiftY, width: widest, height: bottom };
  return { lessons, frames, bounds };
}

/** An arrow from one lesson to the next: straight along a row, a curve where the path turns or changes section. */
function edgePath(from: PlacedLesson, to: PlacedLesson): string {
  if (from.row === to.row) {
    const forward = to.x > from.x;
    const y = from.y + LESSON_MEDIA_HEIGHT / 2;
    const startX = forward ? from.x + LESSON_WIDTH : from.x;
    const endX = forward ? to.x : to.x + LESSON_WIDTH;
    return `M ${startX} ${y} L ${endX} ${y}`;
  }
  const startX = from.x + LESSON_WIDTH / 2;
  const startY = from.y + LESSON_HEIGHT;
  const endX = to.x + LESSON_WIDTH / 2;
  const endY = to.y;
  const bend = (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
}

function edgeState(from: Lesson, to: Lesson): StudyCourseLessonState {
  if (from.state === "completed" && to.state !== "locked") return "completed";
  return from.state === "current" ? "current" : "locked";
}

const stateLabel: Record<StudyCourseLessonState, string> = { completed: "Completed", current: "Now studying", locked: "Locked" };

/**
 * The course board drawn into the canvas layer; the current lesson's node holds the live player.
 * Focused, only that node renders. The empty slots keep the player's node in place, so the video keeps playing.
 */
export function CourseGraph({ course, player, focusRect }: { course: StudySessionCourse; player: ReactNode; focusRect: CanvasRect | null }) {
  const { lessons, frames, bounds } = layoutCourse(course);
  const focused = focusRect !== null;
  const shown = focused ? lessons.filter(({ lesson }) => lesson.state === "current") : lessons;
  return (
    <>
      {focused ? null : frames.map((frame) => (
        <section key={frame.id} className="course-frame" aria-label={frame.title} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, "--frame-hue": frame.hue } as CSSProperties}>
          <h2 className="course-frame-title">{frame.title}</h2>
        </section>
      ))}
      {focused ? null : <svg className="course-edges" aria-hidden="true" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
        <defs>
          {(["completed", "current", "locked"] as const).map((state) => <marker key={state} id={`course-arrow-${state}`} className={`course-arrow is-${state}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>)}
        </defs>
        {lessons.slice(1).map((to, index) => {
          const from = lessons[index];
          if (!from) return null;
          const state = edgeState(from.lesson, to.lesson);
          return <path key={to.lesson.resourceId} className={`course-edge is-${state}`} d={edgePath(from, to)} markerEnd={`url(#course-arrow-${state})`} />;
        })}
      </svg>}
      <ol className="course-lessons" aria-label={`${course.title} lessons`}>
        {shown.map(({ lesson, number, x, y }) => (
          <li key={lesson.resourceId} className={`course-node is-${lesson.state}${focusRect ? " is-full-view" : ""}`} style={focusRect ? { left: focusRect.x, top: focusRect.y, width: focusRect.width } : { left: x, top: y, width: LESSON_WIDTH }} aria-current={lesson.state === "current" ? "step" : undefined}>
            <div className="course-node-media" style={{ height: focusRect ? focusRect.height : LESSON_MEDIA_HEIGHT }}>
              {lesson.state === "current" ? player : (
                <>
                  {lesson.youtubeId ? <img src={`https://i.ytimg.com/vi/${lesson.youtubeId}/hqdefault.jpg`} alt="" loading="lazy" draggable={false} /> : null}
                  <span className="course-node-badge">{lesson.state === "completed" ? <Check aria-hidden="true" /> : <Lock aria-hidden="true" />}</span>
                </>
              )}
            </div>
            <div className="course-node-copy">
              <span className="course-node-meta">Lesson {number} · {stateLabel[lesson.state]}{lesson.state === "current" && lesson.progressPct > 0 ? ` · ${Math.round(lesson.progressPct)}%` : ""}</span>
              <h3 title={lesson.title}>{lesson.title}</h3>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
