// A throwaway Convex backend on this machine for e2e checks and promo capture, so test players and
// bots never use the cloud quota (Database I/O, function calls). Runs `convex dev` in anonymous
// local mode inside a scratch copy of the project, so the shared .env.local is never touched.
// The backend picks a free port, so several checkouts can run at once.
//   E2E_CLOUD=1  use the DEV cloud deployment from .env.local instead
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Outside the repo so Vite and tsc don't watch it; one per checkout (worktrees get their own). */
export const LOCAL_DIR = path.join(root, "..", `.convex-local-${path.basename(root)}`);

const readEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => /^\w+=/.test(l))
      .map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );

const cliEnv = () => {
  const env = { ...process.env, CONVEX_AGENT_MODE: "anonymous", CONVEX_TMPDIR: path.join(LOCAL_DIR, ".tmp") };
  delete env.CONVEX_DEPLOYMENT;
  delete env.CONVEX_DEPLOY_KEY;
  delete env.CONVEX_URL;
  return env;
};

let proc = null;
let started = null;

/**
 * Starts the backend and pushes the current convex/ functions (memoised). Resolves with
 * `{ url, local }`; with E2E_CLOUD=1, the dev cloud URL from .env.local.
 */
export function startConvex() {
  if (started) return started;
  if (process.env.E2E_CLOUD) {
    return (started = Promise.resolve({ url: readEnv(path.join(root, ".env.local")).VITE_CONVEX_URL, local: false }));
  }
  mkdirSync(path.join(LOCAL_DIR, ".tmp"), { recursive: true });
  rmSync(path.join(LOCAL_DIR, "convex"), { recursive: true, force: true });
  cpSync(path.join(root, "convex"), path.join(LOCAL_DIR, "convex"), { recursive: true });
  cpSync(path.join(root, "package.json"), path.join(LOCAL_DIR, "package.json"));
  const nm = path.join(LOCAL_DIR, "node_modules");
  if (!existsSync(nm)) symlinkSync(realpathSync(path.join(root, "node_modules")), nm);

  started = new Promise((resolve, reject) => {
    // detached: its own process group, so stopConvex() also takes down the backend binary
    proc = spawn("npx", ["convex", "dev", "--codegen", "disable", "--typecheck", "disable", "--tail-logs", "disable"], {
      cwd: LOCAL_DIR,
      env: cliEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let log = "";
    const t = setTimeout(() => reject(new Error("local convex did not start:\n" + log)), 120000);
    const onData = (d) => {
      log += d;
      if (/Convex functions ready/.test(log)) {
        clearTimeout(t);
        resolve({ url: readEnv(path.join(LOCAL_DIR, ".env.local")).VITE_CONVEX_URL, local: true });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (c) => reject(new Error(`local convex exited ${c}:\n${log}`)));
  });
  return started;
}

export function stopConvex() {
  if (!proc) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {}
  proc = null;
}
process.on("exit", stopConvex);

/** `npx convex run <fn> <args>` against the backend startConvex() chose. Returns parsed JSON. */
export function convexRun(fn, args = {}) {
  const local = !process.env.E2E_CLOUD;
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    cwd: local ? LOCAL_DIR : root,
    env: local ? cliEnv() : process.env,
    encoding: "utf8",
  });
  return JSON.parse(out.slice(out.search(/[[{]/)));
}
