// Builds the final demo video from a screen recording made with
// playwright.demo.config.ts:
//   1. crops the screen to the browser window and scales it to 1920 wide,
//   2. cuts network waits (marked in the spec) and any other long still
//      stretch down to a moment, keeping wallet popups whole.
//
//   node e2e/demo/compose.mjs [out.mp4]
// Needs ffmpeg on PATH. Reads DEMO_VIDEO_DIR/timeline.json.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const dir = process.env.DEMO_VIDEO_DIR ?? path.resolve(import.meta.dirname, "../../test-results/demo-video");
const out = path.resolve(process.argv[2] ?? path.join(dir, "sendall-demo.mp4"));
const timeline = JSON.parse(readFileSync(path.join(dir, "timeline.json"), "utf8"));
const staged = path.join(dir, "composed-full.mp4");

const KEEP = 0.6; // seconds kept at each end of a cut wait
const STILL = 3.5; // a still stretch longer than this is cut too

const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString();
const probe = (file, entries) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file]).toString().trim();

// 1. Crop to the browser window (screen points to captured pixels).
const [capturedWidth] = probe(timeline.screen, "stream=width,height").split(",").map(Number);
const k = capturedWidth / timeline.window.screenWidth;
const even = (n) => Math.round(n / 2) * 2;
const w = timeline.window;
const crop = `${even(w.width * k)}:${even(w.height * k)}:${even(w.left * k)}:${even(w.top * k)}`;
ffmpeg(["-i", timeline.screen, "-vf", `crop=${crop},scale=1920:-2:flags=lanczos,fps=30`, "-an", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-pix_fmt", "yuv420p", staged]);
const popups = timeline.popups.filter((p) => p.end != null);

// 2. Decide what to cut.
const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", staged]).toString());
const stills = [];
// freezedetect reports on stderr.
const detect = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${staged}" -vf freezedetect=n=0.002:d=${STILL} -an -f null - 2>&1`], { encoding: "utf8", maxBuffer: 1 << 26 });
let s = null;
for (const m of detect.matchAll(/freeze_(start|end): ([\d.]+)/g)) {
  if (m[1] === "start") s = Number(m[2]);
  else if (s != null) stills.push({ start: s, end: Number(m[2]) }), (s = null);
}
if (s != null) stills.push({ start: s, end: duration });

// A still stretch keeps its first 2.8 s so captions stay readable.
const cuts = [
  ...timeline.skips.map((w) => [w.start + KEEP, w.end - KEEP]),
  ...stills.map((f) => [f.start + 2.8, f.end - KEEP]),
]
  .filter(([a, b]) => b - a > 0.3)
  // Never cut into a wallet popup.
  .flatMap(([a, b]) => {
    let parts = [[a, b]];
    for (const p of popups) {
      const ps = p.start - 0.3, pe = p.end + 0.8;
      parts = parts.flatMap(([x, y]) => (pe <= x || ps >= y ? [[x, y]] : [[x, ps], [pe, y]].filter(([u, v]) => v - u > 0.3)));
    }
    return parts;
  })
  .sort((x, y) => x[0] - y[0]);

// Merge overlapping cuts.
const merged = [];
for (const c of cuts) {
  const last = merged.at(-1);
  if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
  else merged.push([...c]);
}
const cutExpr = merged.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+") || "0";

// 3. Final cut.
ffmpeg(["-i", staged, "-vf", `select='not(${cutExpr})',setpts=N/FRAME_RATE/TB`, "-an", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
const final = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(`popups: ${popups.length}, cuts: ${merged.length}, ${duration.toFixed(0)} s -> ${final.toFixed(0)} s`);
console.log(out);
