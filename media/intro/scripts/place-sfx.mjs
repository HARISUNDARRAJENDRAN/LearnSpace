// Writes the <audio> clips into index.html from cues.json: each cue names the frame its sound belongs to ("at"),
// and the clip starts so the file's peak (sfx-peaks.json, measured) lands one frame later.
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("..", import.meta.url).pathname;
const cues = JSON.parse(readFileSync(dir + "scripts/cues.json", "utf8"));
const peaks = JSON.parse(readFileSync(dir + "scripts/sfx-peaks.json", "utf8"));
const lanes = []; // end time of the last clip on each lane
const tags = cues.map(({ file, at, vol }) => {
  const [dur, peak] = peaks[file] ?? (() => { throw new Error(`no measured peak for ${file}`); })();
  const start = Math.max(0, +(at - peak + 1 / 30).toFixed(3));
  let lane = lanes.findIndex((end) => end <= start);
  if (lane < 0) lane = lanes.push(0) - 1;
  lanes[lane] = start + dur;
  return `      <audio id="sfx-${file}" class="clip" src="assets/sfx/${file}.wav" data-start="${start}" data-duration="${dur}" data-volume="${vol}" data-track-index="${10 + lane}"></audio>`;
});
const path = dir + "index.html";
const html = readFileSync(path, "utf8");
const out = html.replace(/(<!-- sfx:begin[^>]*-->)[\s\S]*?(\s*<!-- sfx:end -->)/, `$1\n${tags.join("\n")}$2`);
if (out === html && !html.includes("sfx:begin")) throw new Error("sfx markers missing in index.html");
writeFileSync(path, out);
console.log(`${tags.length} cues on ${lanes.length} lanes`);
