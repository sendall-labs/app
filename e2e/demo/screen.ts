// Demo recording helpers: records the real screen (so the browser window
// and Freighter's own popup windows are in the video) and draws a visible
// mouse cursor, since Playwright's clicks never move the system cursor.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";

// The cursor: an arrow that follows mouse events, with a ring on click.
const CURSOR_SCRIPT = () => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-2.9 1.5-3.9-7.5L4 20.3z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      transition: "transform 70ms linear",
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))",
    });
    const saved = sessionStorage.getItem("__demo_cursor");
    const [x, y] = saved
      ? saved.split(",").map(Number)
      : [window.innerWidth / 2, window.innerHeight / 2];
    c.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    document.documentElement.appendChild(c);
    addEventListener(
      "mousemove",
      (e) => {
        c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
        sessionStorage.setItem("__demo_cursor", `${e.clientX},${e.clientY}`);
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div");
        Object.assign(r.style, {
          position: "fixed",
          left: `${e.clientX - 18}px`,
          top: `${e.clientY - 18}px`,
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "3px solid rgba(139,124,255,.95)",
          zIndex: "2147483646",
          pointerEvents: "none",
          transition: "transform .45s ease-out, opacity .45s ease-out",
        });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => {
          r.style.transform = "scale(1.8)";
          r.style.opacity = "0";
        });
        setTimeout(() => r.remove(), 500);
      },
      true,
    );
  };
  if (document.documentElement) install();
  else addEventListener("DOMContentLoaded", install);
};

export async function installCursor(target: BrowserContext | Page) {
  if ("newPage" in target) await target.addInitScript(CURSOR_SCRIPT);
  else await target.evaluate(CURSOR_SCRIPT).catch(() => {});
}

// Every click and hover glides the cursor to the target first, so the
// viewer can follow what is being pressed.
const positions = new WeakMap<Page, { x: number; y: number }>();
async function glide(locator: Locator) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = positions.get(page);
  if (!from) {
    const vp = await page.evaluate(() => ({
      x: innerWidth / 2,
      y: innerHeight / 2,
    }));
    await page.mouse.move(vp.x, vp.y);
  }
  const steps = Math.max(
    12,
    Math.min(
      40,
      Math.round(Math.hypot(to.x - (from?.x ?? 0), to.y - (from?.y ?? 0)) / 25),
    ),
  );
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const sx = from?.x ?? to.x,
      sy = from?.y ?? to.y;
    await page.mouse.move(sx + (to.x - sx) * e, sy + (to.y - sy) * e);
    await page.waitForTimeout(12);
  }
  positions.set(page, to);
  await page.waitForTimeout(250);
}

let patched = false;
export function patchClicksToGlide(anyLocator: Locator) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(anyLocator) as Locator;
  for (const name of ["click", "hover", "check"] as const) {
    const original = proto[name] as (
      this: Locator,
      ...args: unknown[]
    ) => Promise<void>;
    (proto as unknown as Record<string, unknown>)[name] = async function (
      this: Locator,
      ...args: unknown[]
    ) {
      await glide(this);
      return original.apply(this, args);
    };
  }
}

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
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "normal" },
  });
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
      execFileSync(
        "osascript",
        ["-e", `tell application "${app}" to activate`],
        { stdio: "ignore", timeout: 5000 },
      );
      return;
    } catch {}
  }
}

function screenDevice() {
  const out = (() => {
    try {
      return execFileSync(
        "sh",
        [
          "-c",
          'ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1',
        ],
        { encoding: "utf8" },
      );
    } catch (e) {
      return String((e as { stdout?: string }).stdout ?? "");
    }
  })();
  const m = out.match(/\[(\d+)\] Capture screen 0/);
  if (!m)
    throw new Error(
      "No screen capture device: give the terminal app Screen Recording permission.",
    );
  return m[1];
}

/** Starts recording the main display; resolves once frames are coming in. */
export async function startScreenRecording(
  file: string,
): Promise<{ stop: () => Promise<void>; startedAt: number }> {
  // Playwright empties test-results when the run starts.
  mkdirSync(path.dirname(file), { recursive: true });
  const ff: ChildProcess = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "avfoundation",
      "-capture_cursor",
      "0",
      "-framerate",
      "30",
      "-pixel_format",
      "nv12",
      "-i",
      `${screenDevice()}:none`,
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      "24M",
      "-r",
      "30",
      file,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  const startedAt = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("screen recording did not start")),
      20_000,
    );
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
