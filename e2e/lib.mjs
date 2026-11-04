// Shared helpers for the headless browser checks in e2e/. See CLAUDE.md ("Testing").
// Starts its own Vite dev server (uses .env.local → the DEV Convex deployment), launches
// headless Chromium with software GL, and joins players through the real join screen.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(root, "e2e", "out");
mkdirSync(OUT, { recursive: true });

const errors = [];
let server, browser;

/** Vite dev server on a free-ish port; resolves with its URL. Reuse one with E2E_URL=http://127.0.0.1:5173/. */
export async function startServer() {
  if (process.env.E2E_URL) return process.env.E2E_URL;
  const port = 5300 + Math.floor(Math.random() * 400);
  server = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("vite did not start")), 30000);
    server.stdout.on("data", (d) => String(d).includes("Local:") && (clearTimeout(t), resolve()));
    server.on("exit", (c) => reject(new Error("vite exited " + c)));
  });
  return `http://127.0.0.1:${port}/`;
}

export async function launch() {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  return browser;
}

/**
 * Opens the game as a new device and joins as `name`. Returns the page plus `g(expr)`,
 * which evaluates an expression against the DEV-only `window.__game` hooks.
 * Software GL is slow: pages load with ?lowgfx and generous timeouts.
 */
export async function player(url, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 480 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${name} console] ${m.text()}`));
  await page.goto(url + "?lowgfx", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#joinBtn");
  await page.fill("#nameInput", name);
  await page.click("#joinBtn");
  await page.waitForFunction(() => window.__game && !document.getElementById("ui").classList.contains("hidden"));
  const g = (expr) => page.evaluate(`(() => { const G = window.__game; return (${expr}); })()`);
  return { page, g, name };
}

/** Polls `fn` until truthy (or throws after `ms`). */
export async function until(fn, ms = 30000, what = "condition") {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

export const shot = (p, name) => p.page.screenshot({ path: path.join(OUT, name + ".png") });
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function check(ok, msg) {
  if (!ok) errors.push("FAIL: " + msg);
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
}

/** Closes everything; exits non-zero if any check failed or a page threw. */
export async function finish() {
  await browser?.close();
  server?.kill();
  if (errors.length) {
    console.log("\n" + errors.join("\n"));
    process.exit(1);
  }
  console.log(`\nall good · screenshots in ${path.relative(process.cwd(), OUT)}/`);
  process.exit(0);
}

process.on("unhandledRejection", async (e) => {
  console.error(e);
  await browser?.close();
  server?.kill();
  process.exit(1);
});
