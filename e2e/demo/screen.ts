// Demo recording helpers. The demo is recorded like a person would record
// it: the real screen, the real system cursor. Every click in the spec moves
// the macOS mouse to the element and clicks it (mouse.swift), and each move
// is logged so compose.mjs can zoom in on it the way Screen Studio does.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

// --- Real mouse -----------------------------------------------------------

const MOUSE_SRC = path.resolve(__dirname, "mouse.swift");
const MOUSE_BIN = path.resolve(__dirname, "../../node_modules/.cache/demo-mouse/mouse");

function buildMouse() {
  if (existsSync(MOUSE_BIN) && statSync(MOUSE_BIN).mtimeMs > statSync(MOUSE_SRC).mtimeMs) return;
  mkdirSync(path.dirname(MOUSE_BIN), { recursive: true });
  execFileSync("swiftc", ["-O", MOUSE_SRC, "-o", MOUSE_BIN]);
}
const mouse = (...args: (string | number)[]) => execFileSync(MOUSE_BIN, args.map(String), { encoding: "utf8" }).trim();
const position = () => mouse("pos").split(" ").map(Number) as [number, number];

/** Builds the mouse helper and checks the OS lets it move the cursor. */
export function checkRealMouse() {
  buildMouse();
  const [x, y] = position();
  const probe = [x > 200 ? x - 40 : x + 40, y];
  mouse("glide", probe[0], probe[1], 80);
  const [px] = position();
  mouse("glide", x, y, 80);
  if (Math.abs(px - probe[0]) > 2) {
    throw new Error("The mouse did not move: give the terminal app Accessibility permission (System Settings, Privacy & Security, Accessibility).");
  }
}

/** Cursor moves, in seconds from the start of the recording and screen points. */
export const cursorLog: { start: number; end: number; x: number; y: number; click: boolean }[] = [];
let recordingStart = 0;

// Where a page's viewport sits on screen: browser windows on macOS have
// their toolbar (or title bar) on top and no side borders.
async function viewportOrigin(page: Page) {
  return page.evaluate(() => ({
    x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
    y: window.screenY + (window.outerHeight - window.innerHeight),
  }));
}

async function moveTo(locator: Locator, click: boolean) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("demo click: element has no box");
  const origin = await viewportOrigin(page);
  const x = Math.round(origin.x + box.x + box.width / 2);
  const y = Math.round(origin.y + box.y + box.height / 2);
  const [cx, cy] = position();
  const distance = Math.hypot(x - cx, y - cy);
  const ms = distance < 4 ? 0 : Math.round(Math.min(1100, 350 + distance * 0.6));
  const start = (Date.now() - recordingStart) / 1000;
  if (ms) mouse("glide", x, y, ms);
  if (click) {
    await page.waitForTimeout(180);
    mouse("click", x, y);
  }
  cursorLog.push({ start, end: (Date.now() - recordingStart) / 1000, x, y, click });
}

let patched = false;
/**
 * Makes every Locator click and hover use the real mouse. `check` (radio
 * buttons) is a click too.
 */
export function useRealMouse(anyLocator: Locator) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(anyLocator) as Record<string, unknown>;
  proto.click = async function (this: Locator) {
    await this.waitFor({ state: "visible" });
    // Like Playwright's own click, wait for a disabled button to enable.
    for (let i = 0; i < 300 && !(await this.isEnabled()); i++) await this.page().waitForTimeout(100);
    await moveTo(this, true);
  };
  proto.check = proto.click;
  proto.hover = async function (this: Locator) {
    await this.waitFor({ state: "visible" });
    await moveTo(this, false);
  };
}

// --- Window and screen ----------------------------------------------------

/** Fits the browser window to the usable screen area and returns its bounds in screen points. */
export async function fitWindow(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  const screen = await page.evaluate(() => ({
    left: (window.screen as Screen & { availLeft: number }).availLeft,
    top: (window.screen as Screen & { availTop: number }).availTop,
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  }));
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: screen });
  await page.waitForTimeout(800);
  // The window as it ended up, plus the full screen width to map points to
  // captured pixels.
  return page.evaluate(() => ({
    left: window.screenX,
    top: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
    screenWidth: window.screen.width,
  }));
}

/** Brings the Playwright browser to the front of the desktop. */
export function activateBrowser() {
  for (const app of ["Google Chrome for Testing", "Chromium"]) {
    try {
      execFileSync("osascript", ["-e", `tell application "${app}" to activate`], { stdio: "ignore", timeout: 5000 });
      return;
    } catch {}
  }
}

function screenDevice() {
  const out = (() => {
    try {
      return execFileSync("sh", ["-c", 'ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1'], { encoding: "utf8" });
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? "");
    }
  })();
  const m = out.match(/\[(\d+)\] Capture screen 0/);
  if (!m) throw new Error("No screen capture device: give the terminal app Screen Recording permission.");
  return m[1];
}

/** Starts recording the main display, cursor included; resolves once frames are coming in. */
export async function startScreenRecording(file: string): Promise<{ stop: () => Promise<void>; startedAt: number }> {
  // Playwright empties test-results when the run starts.
  mkdirSync(path.dirname(file), { recursive: true });
  const ff: ChildProcess = spawn(
    "ffmpeg",
    ["-y", "-f", "avfoundation", "-capture_cursor", "1", "-framerate", "30", "-pixel_format", "nv12", "-i", `${screenDevice()}:none`,
     "-c:v", "h264_videotoolbox", "-b:v", "24M", "-r", "30", file],
    { stdio: ["pipe", "ignore", "pipe"] }
  );
  const startedAt = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("screen recording did not start")), 20_000);
    ff.stderr!.on("data", (d: Buffer) => {
      // The first progress line comes in after some frames: date the
      // recording from its first frame.
      const m = d.toString().match(/frame=\s*(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Date.now() - (Number(m[1]) / 30) * 1000);
      }
    });
    ff.on("exit", (code) => reject(new Error(`ffmpeg exited ${code}`)));
  });
  ff.stderr!.removeAllListeners("data");
  ff.stderr!.resume();
  recordingStart = startedAt;
  return {
    startedAt,
    stop: () =>
      new Promise<void>((resolve) => {
        ff.on("exit", () => resolve());
        ff.stdin!.write("q");
        setTimeout(() => ff.kill("SIGINT"), 10_000);
      }),
  };
}
