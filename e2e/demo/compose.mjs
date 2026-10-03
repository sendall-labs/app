// Builds the final demo video from a screen recording made with
// playwright.demo.config.ts, in the style of Screen Studio:
//   1. crops the screen to the browser window,
//   2. zooms in smoothly where the mouse works and follows it, zooming back
//      out when it rests,
//   3. sets the window with rounded corners and a shadow on a background,
//   4. cuts network waits (marked in the spec) and long still stretches,
//      never cutting into a wallet approval or a zoom.
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

// Canvas and look.
const CW = 1920, CH = 1200, PAD = 64, RADIUS = 16;
const ZOOM = 1.55; // how far in a zoom goes
const ZOOM_IN = 0.7, ZOOM_OUT = 0.9; // seconds
const REST = 1.4; // seconds the zoom holds after the last click of a burst
const BURST_GAP = 2.2; // clicks closer than this share one zoom

// Cuts.
const KEEP = 0.6; // seconds kept at each end of a cut wait
const STILL = 3.5; // a still stretch longer than this is cut too

const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 }).toString();
const probe = (file, entries) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file]).toString().trim();
const even = (n) => Math.round(n / 2) * 2;
const f = (n) => n.toFixed(3);

// --- 1. Geometry -----------------------------------------------------------

const win = timeline.window;
const [capturedWidth] = probe(timeline.screen, "stream=width,height").split(",").map(Number);
const k = capturedWidth / win.screenWidth; // captured pixels per screen point
const crop = `${even(win.width * k)}:${even(win.height * k)}:${even(win.left * k)}:${even(win.top * k)}`;
// The window, scaled to fit the canvas inside the padding.
const scale = Math.min((CW - 2 * PAD) / win.width, (CH - 2 * PAD) / win.height);
const VW = even(win.width * scale), VH = even(win.height * scale);
const VX = (CW - VW) / 2, VY = (CH - VH) / 2;
// Zoom works on a sharper copy of the window so zoomed text stays crisp.
const BW = even(VW * ZOOM), BH = even(VH * ZOOM);
const toBase = (x, y) => [((x - win.left) / win.width) * BW, ((y - win.top) / win.height) * BH];

// --- 2. Zoom path ----------------------------------------------------------

const moves = (timeline.cursor ?? []).filter((m) => m.x >= win.left && m.x <= win.left + win.width && m.y >= win.top && m.y <= win.top + win.height);
const bursts = [];
for (const m of moves) {
  const last = bursts.at(-1);
  if (last && m.start - last.end < BURST_GAP) last.end = m.end;
  else bursts.push({ start: m.start, end: m.end });
}
// Zoom envelopes, merged where one would start before the last ends.
const zooms = [];
for (const b of bursts) {
  const z = { a: Math.max(0, b.start - 0.15), d: b.end + REST + ZOOM_OUT };
  const last = zooms.at(-1);
  if (last && z.a < last.d) last.d = z.d;
  else zooms.push(z);
}
const ease = (u) => `(${u})*(${u})*(3-2*(${u}))`;
const zoomExpr =
  zooms.length === 0
    ? "1"
    : `1+${(ZOOM - 1).toFixed(3)}*(` +
      zooms
        .map(({ a, d }) => {
          const b = a + ZOOM_IN, c = d - ZOOM_OUT;
          return `if(between(it,${f(a)},${f(b)}),${ease(`(it-${f(a)})/${ZOOM_IN}`)},if(between(it,${f(b)},${f(c)}),1,if(between(it,${f(c)},${f(d)}),1-${ease(`(it-${f(c)})/${ZOOM_OUT}`)},0)))`;
        })
        .join("+") +
      ")";
// The zoom centre follows the cursor: it eases to each click target over
// the time the mouse took to get there.
function followExpr(axis) {
  if (moves.length === 0) return axis === 0 ? `${BW / 2}` : `${BH / 2}`;
  const pts = moves.map((m) => toBase(m.x, m.y)[axis]);
  let expr = f(pts[0]);
  for (let j = 1; j < moves.length; j++) {
    const { start, end } = moves[j];
    const span = Math.max(0.2, end - start);
    const from = f(pts[j - 1]), to = f(pts[j]);
    expr = `if(lt(it,${f(start)}),${expr},if(lt(it,${f(start + span)}),${from}+(${to}-${from})*${ease(`(it-${f(start)})/${f(span)}`)},${to}))`;
  }
  return expr;
}
const zx = `max(0,min(iw-iw/zoom,(${followExpr(0)})-iw/zoom/2))`;
const zy = `max(0,min(ih-ih/zoom,(${followExpr(1)})-ih/zoom/2))`;

// --- 3. Look ---------------------------------------------------------------

const look = path.join(dir, "look");
execFileSync("mkdir", ["-p", look]);
const bg = path.join(look, "bg.png"), mask = path.join(look, "mask.png"), shadow = path.join(look, "shadow.png");
// A deep violet diagonal gradient, Sendall's colours.
ffmpeg(["-f", "lavfi", "-i", `color=black:s=${CW}x${CH}`, "-frames:v", "1", "-vf",
  `format=rgb24,geq=r='28+(X/W+Y/H)*0.5*70':g='22+(X/W+Y/H)*0.5*36':b='64+(X/W+Y/H)*0.5*150'`, bg]);
const rounded = (r) => `if(gt(abs(X-W/2+0.5),W/2-${r})*gt(abs(Y-H/2+0.5),H/2-${r}),if(lte(hypot(abs(X-W/2+0.5)-(W/2-${r}),abs(Y-H/2+0.5)-(H/2-${r})),${r}),255,0),255)`;
ffmpeg(["-f", "lavfi", "-i", `color=white:s=${VW}x${VH}`, "-frames:v", "1", "-vf", `format=gray,geq=lum='${rounded(RADIUS)}'`, mask]);
const SB = 40; // shadow blur margin
ffmpeg(["-f", "lavfi", "-i", `color=black:s=${VW + 2 * SB}x${VH + 2 * SB}`, "-frames:v", "1", "-vf",
  `format=rgba,geq=r=0:g=0:b=0:a='if(between(X,${SB},W-${SB})*between(Y,${SB},H-${SB}),150,0)',boxblur=luma_radius=22:luma_power=3:alpha_radius=22:alpha_power=3`, shadow]);

// --- 4. Render the full timeline -------------------------------------------

const graph = [
  `[0:v]crop=${crop},scale=${BW}:${BH}:flags=lanczos,fps=30,` +
    `zoompan=z='${zoomExpr}':x='${zx}':y='${zy}':d=1:s=${VW}x${VH}:fps=30,format=rgba[win]`,
  `[3:v]format=gray[m]`,
  `[win][m]alphamerge[rwin]`,
  `[1:v][2:v]overlay=${VX - SB}:${VY - SB + 14}[bgs]`,
  `[bgs][rwin]overlay=${VX}:${VY}:shortest=1,format=yuv420p[v]`,
].join(";");
// Still images loop for exactly the length of the recording.
const screenSeconds = probe(timeline.screen, "format=duration").split("\n")[0];
const still = (file) => ["-loop", "1", "-framerate", "30", "-t", screenSeconds, "-i", file];
ffmpeg(["-i", timeline.screen, ...still(bg), ...still(shadow), ...still(mask),
  "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "16", "-preset", "fast", staged]);

// --- 5. Decide what to cut -------------------------------------------------

const popups = timeline.popups.filter((p) => p.end != null);
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

// Wallet approvals and zooms play whole.
const protectedSpans = [...popups.map((p) => [p.start - 0.3, p.end + 0.8]), ...zooms.map((z) => [z.a - 0.2, z.d + 0.2])];
// A still stretch keeps its first 2.8 s so captions stay readable.
const cuts = [...timeline.skips.map((w) => [w.start + KEEP, w.end - KEEP]), ...stills.map((st) => [st.start + 2.8, st.end - KEEP])]
  .filter(([a, b]) => b - a > 0.3)
  .flatMap(([a, b]) => {
    let parts = [[a, b]];
    for (const [ps, pe] of protectedSpans) {
      parts = parts.flatMap(([x, y]) => (pe <= x || ps >= y ? [[x, y]] : [[x, ps], [pe, y]].filter(([u, v]) => v - u > 0.3)));
    }
    return parts;
  })
  .sort((x, y) => x[0] - y[0]);

const merged = [];
for (const c of cuts) {
  const last = merged.at(-1);
  if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
  else merged.push([...c]);
}
const cutExpr = merged.map(([a, b]) => `between(t,${f(a)},${f(b)})`).join("+") || "0";

// --- 6. Final cut ----------------------------------------------------------

ffmpeg(["-i", staged, "-vf", `select='not(${cutExpr})',setpts=N/FRAME_RATE/TB`, "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
const final = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(`zooms: ${zooms.length}, popups: ${popups.length}, cuts: ${merged.length}, ${duration.toFixed(0)} s -> ${final.toFixed(0)} s`);
console.log(out);
