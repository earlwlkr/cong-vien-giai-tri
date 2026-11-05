// Promo capture harness: renders the real game frame by frame on a fake clock, so videos come out a
// smooth 30 fps even on software GL, and fills the park with scripted bot players on a local Convex
// backend (e2e/convex-local.mjs; E2E_CLOUD=1 for the DEV cloud deployment). See promo/README.md.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { startServer } from "../e2e/lib.mjs";
import { startConvex } from "../e2e/convex-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = process.env.PROMO_OUT ?? path.join(root, "promo", "out");
mkdirSync(OUT, { recursive: true });

// the same backend startServer() points the game at (never prod: local, or .env.local's dev)
const { url: CONVEX_URL } = await startConvex();
export const convex = new ConvexHttpClient(CONVEX_URL);

export const FPS = 30;
export const W = +(process.env.W ?? 1920), H = +(process.env.H ?? 1080);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- viewer
let browser, server;
/** The recording player. `g(expr)` evaluates against window.__game (G). */
export async function viewer({ name = "Hà My", look = { style: "catHood", skin: 1, hair: 6, shoes: 2 }, color = "#ff4e7a", spot } = {}) {
  const url = await startServer();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
    headless: process.env.INSTABOX_HEADLESS !== "0",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const token = "promo-viewer-" + name.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toLowerCase().padEnd(8, "x");
  await convex.mutation(api.players.saveProfile, { token, name, color, look });
  await page.addInitScript((t) => localStorage.setItem("cvgt-wallet", t), token);
  await page.clock.install();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__game && !document.getElementById("ui").classList.contains("hidden"));
  const g = (expr) => page.evaluate(`(() => { const G = window.__game; return (${expr}); })()`);
  // stop resyncing time against the real clock; render exactly one game frame per video frame
  await page.evaluate(() => {
    window.__holdTime = true;
    window.__rafq = [];
    window.requestAnimationFrame = (cb) => (window.__rafq.push(cb), window.__rafq.length);
  });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  if (spot) await g(`G.tp(${spot[0]}, ${spot[1]})`);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(CAM_HELPERS);
  const v = { page, g, url, name };
  // let the world settle: textures, first shadow maps, player list
  await step(v, 20);
  return v;
}

const CSS = `
body.promo-clean #ui > *:not(#toast) { display: none !important; }
body.promo-clean #toast { display: none !important; }
body.promo-nochat #chat { display: none !important; }
#chatForm { display: none !important; }
body.promo-tidy #toast, body.promo-tidy #exitBtn, body.promo-tidy #topRight .round, body.promo-tidy #prompt, body.promo-tidy #useBtn { display: none !important; }
`;

/** In-page camera helpers: smooth keyframe paths and ride tracking. */
const CAM_HELPERS = `(() => {
  const ss = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, u) => a + (b - a) * u;
  // Catmull-Rom through points, u in [0,1] over the whole list
  function cr(pts, u) {
    const n = pts.length - 1, f = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(f), t = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    return p1.map((_, k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));
  }
  window.__cam = {
    /** Camera along a spline of positions looking along a spline of targets over 'dur' seconds. */
    path({ pos, look, dur, fov = 55, fov2, ease = true }) {
      let t0 = null;
      return (cam, now, t) => {
        if (t0 === null) t0 = t;
        let u = Math.min(1, (t - t0) / dur);
        if (ease) u = ss(u);
        const p = cr(pos, u), l = cr(look, u);
        cam.up.set(0, 1, 0);
        cam.position.set(p[0], p[1], p[2]);
        cam.lookAt(l[0], l[1], l[2]);
        cam.fov = fov2 ? lerp(fov, fov2, u) : fov;
        return cam.position.clone().set(l[0], 0, l[2]);
      };
    },
    /** Orbit around a centre. */
    orbit({ c, r, h, a0, a1, dur, lookY = 0, fov = 55, r2, h2 }) {
      let t0 = null;
      return (cam, now, t) => {
        if (t0 === null) t0 = t;
        const u = Math.min(1, (t - t0) / dur);
        const a = lerp(a0, a1, u), rr = r2 ? lerp(r, r2, u) : r, hh = h2 ? lerp(h, h2, u) : h;
        cam.up.set(0, 1, 0);
        cam.position.set(c[0] + Math.sin(a) * rr, hh, c[2] + Math.cos(a) * rr);
        cam.lookAt(c[0], lookY, c[2]);
        cam.fov = fov;
        return cam.position.clone().set(c[0], 0, c[2]);
      };
    },
    /** Fixed camera that keeps a rider in frame. */
    track({ pos, kind, ride, fov = 55, lookOff = [0, 0, 0], smooth = 0 }) {
      const def = window.__game.rides.get(kind);
      let P = null, Q = null, tgt = null, prevT = null;
      return (cam, now, t) => {
        if (!P) { P = cam.position.clone(); Q = cam.quaternion.clone(); }
        def.seatPose(ride, now, P, Q);
        P.x += lookOff[0]; P.y += lookOff[1]; P.z += lookOff[2];
        const k = !tgt || !smooth ? 1 : 1 - Math.exp(-(t - prevT) * smooth);
        prevT = t;
        tgt = tgt ? tgt.lerp(P, k) : P.clone();
        cam.up.set(0, 1, 0);
        cam.position.set(pos[0], pos[1], pos[2]);
        cam.lookAt(tgt);
        cam.fov = fov;
        return tgt.clone().setY(0);
      };
    },
    /** Follow a seat on a clock-driven ride: offset in the seat's frame (x right, y up, z forward). */
    follow({ kind, ride, off, look = [0, 0, 6], fov = 60, smooth = 0, upWorld = true, world = false }) {
      const def = window.__game.rides.get(kind);
      let P = null, Q = null, cur = null, tgt = null, prevT = null;
      return (cam, now, t) => {
        if (!P) { P = cam.position.clone(); Q = cam.quaternion.clone(); cur = cam.position.clone(); tgt = cam.position.clone(); }
        const r = typeof ride === "function" ? ride(now) : ride;
        def.seatPose(r, now, P, Q);
        const o = P.clone().set(off[0], off[1], off[2]), l = P.clone().set(look[0], look[1], look[2]);
        if (!world) { o.applyQuaternion(Q); l.applyQuaternion(Q); }
        o.add(P); l.add(P);
        const dt = prevT === null ? 1 : t - prevT; prevT = t;
        const k = smooth ? 1 - Math.exp(-dt * smooth) : 1;
        cur.lerp(o, prevT === t && k === 1 ? 1 : k);
        tgt.lerp(l, k);
        cam.position.copy(cur);
        cam.up.set(0, 1, 0);
        if (!upWorld) cam.up.set(0, 1, 0).applyQuaternion(Q);
        cam.lookAt(tgt);
        cam.fov = fov;
        return P.clone();
      };
    },
  };
})()`;

/** Sets the in-page camera director from a JS expression (has G and __cam in scope), or null for the game camera. */
export const cine = (v, expr) => v.g(expr ? `(G.cine = (() => { const C = window.__cam; return ${expr}; })(), 1)` : "(G.cine = null, 1)");
export const ui = (v, { clean = false, chat = true, tidy = true } = {}) =>
  v.page.evaluate(([c, ch, td]) => {
    document.body.classList.toggle("promo-clean", c);
    document.body.classList.toggle("promo-nochat", !ch);
    document.body.classList.toggle("promo-tidy", td);
  }, [clean, chat, tidy]);
export const clearChat = (v) => v.page.evaluate(() => (document.getElementById("chatLog").innerHTML = ""));

/** Advances the game n frames without saving them (bots tick too). */
export async function step(v, n = 1, onFrame) {
  for (let i = 0; i < n; i++) {
    if (onFrame) await onFrame(i);
    await bots.tick(v);
    await frame(v);
  }
}
async function frame(v) {
  await v.page.clock.runFor(1000 / FPS);
  await v.page.evaluate(() => {
    const q = window.__rafq.splice(0);
    for (const cb of q) cb(performance.now());
  });
}

/**
 * Records `sec` seconds to OUT/<name>.mp4. `onFrame(i, tSec)` runs before each frame (move bots,
 * press keys...). `stills`: frame indices to also save as lossless PNG (OUT/<name>-<i>.png).
 */
export async function record(v, name, sec, { onFrame, stills = [] } = {}) {
  const dir = path.join(OUT, "frames", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.round(sec * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (onFrame) await onFrame(i, i / FPS);
    await bots.tick(v);
    await frame(v);
    await v.page.screenshot({ path: path.join(dir, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 95 });
    if (stills.includes(i)) await v.page.screenshot({ path: path.join(OUT, `${name}-${i}.png`) });
    if (i % 30 === 0) process.stdout.write(`\r${name}: ${i}/${n} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
  }
  process.stdout.write(`\r${name}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s          \n`);
  encode(dir, path.join(OUT, `${name}.mp4`));
}

export function encode(dir, out) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "%05d.jpg"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed for " + out);
}

export const shot = (v, name) => v.page.screenshot({ path: path.join(OUT, name + ".png") });

// ---------------------------------------------------------------- bots
const LOOKS = ["tuft", "buns", "catHood", "bow", "bearHood"];
const COLORS = ["#ff4e7a", "#ff9f1c", "#ffd166", "#06d6a0", "#2ec4b6", "#3a86ff", "#8338ec", "#f72585", "#8d99ae", "#e63946"];
export const BOT_NAMES = ["Minh", "Lan", "Huy", "Thảo", "Bảo", "Ngọc", "Khoa", "Vy", "Tú", "Linh", "An", "Mai", "Phúc", "Trang", "Đạt", "Hân"];

/**
 * Scripted players. Each bot has either a `walk(tSec)` -> {x, z, ry?, anim?} function, a fixed spot,
 * or a ride. Positions are sent on virtual time, so they line up with the recorded frames.
 */
const BOT_HEARTBEAT_MS = 5000;
export const bots = {
  list: [],
  vt: 0, // virtual seconds since bots were spawned
  lastSend: -1,
  async spawn(n, place) {
    const made = await Promise.all(Array.from({ length: n }, async (_, k) => {
      const i = this.list.length + k;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const token = `promo-bot-${String(i).padStart(2, "0")}-xxxxxxxxxxxx`;
      const look = { style: LOOKS[(i * 3) % 5], skin: (i * 5) % 6, hair: (i * 3 + 1) % 8, shoes: i % 5 };
      await convex.mutation(api.players.saveProfile, { token, name, color: COLORS[(i * 7) % COLORS.length], look });
      const p = place(k);
      const j = await convex.mutation(api.players.join, { token, fallback: { x: p.x, z: p.z }, at: { x: p.x, z: p.z, ry: p.ry ?? 0 } });
      return { i, id: j.id, name, token, x: p.x, z: p.z, ry: p.ry ?? 0, anim: "idle", walk: null, ride: null, dirty: true };
    }));
    this.list.push(...made);
    return made;
  },
  inflight: null,
  async tick(v) {
    this.vt += 1 / FPS;
    // ~every 110 ms of game time, like a real client; never block the frame on the network
    if (this.vt - this.lastSend < 0.11 || this.inflight) return;
    this.lastSend = this.vt;
    this.inflight = Promise.all(this.list.map(async (b) => {
      if (b.walk) {
        const s = b.walk(this.vt);
        if (!s) return;
        const dx = s.x - b.x, dz = s.z - b.z;
        b.ry = s.ry ?? (Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : b.ry);
        b.anim = s.anim ?? (Math.hypot(dx, dz) > 0.2 ? "walk" : "idle");
        b.x = s.x; b.z = s.z;
      }
      // like the game client: only when something changed, else a heartbeat. Real time, not
      // virtual: the server and the viewer drop players by the server clock (20 s).
      const moved = b.x !== b.sent?.x || b.z !== b.sent?.z || b.ry !== b.sent?.ry || b.anim !== b.sent?.anim;
      if (!moved && Date.now() - b.sent.at < BOT_HEARTBEAT_MS) return;
      b.sent = { x: b.x, z: b.z, ry: b.ry, anim: b.anim, at: Date.now() };
      await convex.mutation(api.players.update, { id: b.id, x: b.x, y: 0, z: b.z, ry: b.ry, anim: b.anim });
    })).catch((e) => console.log("bot update failed", e.message)).finally(() => (this.inflight = null));
  },
  /** Put a bot on a ride (clock-driven rides: the viewer places it from serverNow). */
  async board(b, kind, key, maxSeats, start, preferSeat) {
    b.walk = null;
    const r = await convex.mutation(api.players.board, { id: b.id, kind, key, maxSeats, start, preferSeat });
    b.ride = r;
    return r;
  },
  async unboard(b, x, z) {
    b.ride = null;
    b.x = x; b.z = z;
    await convex.mutation(api.players.unboard, { id: b.id, x, y: 0, z });
  },
  async place(b, x, z, ry = b.ry, anim = "idle") {
    if (b.ride) await this.unboard(b, x, z);
    Object.assign(b, { x, z, ry, anim, walk: null });
  },
  say: (b, text) => convex.mutation(api.chat.send, { id: b.id, text }),
  async buy(b, cart, item) {
    return convex.mutation(api.shop.buy, { id: b.id, token: b.token, cart, item });
  },
  async leaveAll() {
    await Promise.all(this.list.map((b) => convex.mutation(api.players.leave, { id: b.id }).catch(() => {})));
    this.list = [];
  },
};

/** Walk a polyline at `speed` m/s starting at `t0`, looping if `loop`. */
export function walker(pts, { speed = 1.6, t0 = 0, loop = true, anim } = {}) {
  const seg = [];
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    seg.push([L, d]);
    L += d;
  }
  return (t) => {
    let s = Math.max(0, (t - t0) * speed);
    s = loop ? s % L : Math.min(s, L - 1e-3);
    const i = seg.findIndex(([a, d]) => s >= a && s < a + d);
    const [a, d] = seg[Math.max(0, i)];
    const u = (s - a) / d, p = pts[Math.max(0, i)], q = pts[Math.max(0, i) + 1];
    const moving = loop || (t - t0) * speed < L;
    return { x: p[0] + (q[0] - p[0]) * u, z: p[1] + (q[1] - p[1]) * u, anim: moving ? anim ?? (speed > 6 ? "run" : "walk") : "idle", ...(moving ? {} : { ry: undefined }) };
  };
}

export async function done(v) {
  await bots.leaveAll();
  await browser?.close();
  writeFileSync(path.join(OUT, ".last-run"), new Date().toISOString());
}

process.on("unhandledRejection", async (e) => {
  console.error(e);
  await bots.leaveAll().catch(() => {});
  await browser?.close();
  process.exit(1);
});
