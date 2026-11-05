// Promo footage. Each shot records OUT/<name>.mp4 (1920x1080, 30 fps) plus a few PNG stills.
//   node promo/shots.mjs                 all shots
//   node promo/shots.mjs coaster drop    only some
//   PREVIEW=1 node promo/shots.mjs wheel only saves first/middle/last frame (fast framing check)
import { bots, cine, clearChat, done, record as rec, shot, step, ui, viewer, wait, walker, FPS } from "./lib.mjs";

const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);
const PREVIEW = !!process.env.PREVIEW;

const v = await viewer({ spot: [-2, 82] });
const { g, page } = v;

/** Preview mode: step through the shot but only save 3 frames as PNG. */
const TAKES = process.env.TAKES?.split(",");
async function record(name, sec, opts = {}) {
  if (TAKES && !TAKES.includes(name)) {
    // not retaking this one: just play through it so timing stays the same
    const n = Math.round(sec * FPS);
    console.log(`(playing through ${name}: ${n} frames)`);
    for (let i = 0; i < n; i++) {
      if (opts.onFrame) await opts.onFrame(i, i / FPS);
      await step(v, 1);
    }
    return;
  }
  if (!PREVIEW) return rec(v, name, sec, opts);
  const n = Math.round(sec * FPS), keep = [0, Math.floor(n / 2), n - 1];
  for (let i = 0; i < n; i++) {
    if (opts.onFrame) await opts.onFrame(i, i / FPS);
    await step(v, 1);
    if (keep.includes(i)) await shot(v, `preview-${name}-${i}`);
  }
  console.log(`preview ${name}: frames ${keep.join(", ")}`);
}

// ------------------------------------------------------------------ crowd
const B = await bots.spawn(14, (k) => ({ x: -6 + (k % 7) * 2, z: 30 + Math.floor(k / 7) * 3 }));
// a few of them buy things to carry around
const buys = [
  [0, "bongbay", "bong_do", -25, -5.6], [1, "kem", "kem_dau", -6.4, 40], [2, "bongbay", "bong_vang", -25, -5.6],
  [3, "keobong", "keo_cauvong", 24, -6.6], [4, "mia", "nuoc_mia", -6.4, 64], [5, "bongbay", "bong_xanh", -25, -5.6],
  [6, "bap", "bap_caramel", 6.4, 40], [7, "keobong", "keo_hong", 24, -6.6],
];
for (const [i, , , x, z] of buys) await bots.place(B[i], x, z);
bots.lastSend = -1;
await step(v, 4);
await wait(400);
for (const [i, cart, item] of buys) {
  const r = await bots.buy(B[i], cart, item);
  if (!r.ok) console.log("buy failed", B[i].name, r.reason);
}

/** Everyone strolls around the plaza and the avenue. */
function ambient() {
  const ring = (r, a0, cw = 1) => Array.from({ length: 25 }, (_, j) => {
    const a = a0 + (cw * j * Math.PI * 2) / 24;
    return [Math.sin(a) * r, Math.cos(a) * r];
  });
  const plans = [
    walker(ring(13, 0), { speed: 1.5 }),
    walker([[-2.5, 88], [-2.5, 20], [2.5, 20], [2.5, 88], [-2.5, 88]], { speed: 1.7, t0: -10 }),
    walker(ring(16, 2, -1), { speed: 1.4 }),
    walker([[2.5, 20], [2.5, 88], [-2.5, 88], [-2.5, 20], [2.5, 20]], { speed: 1.6, t0: -30 }),
    walker(ring(11, 4), { speed: 1.3 }),
    walker([[-1.5, 75], [-1.5, 22], [1.5, 22], [1.5, 75], [-1.5, 75]], { speed: 1.5, t0: -5 }),
    walker(ring(15, 1, -1), { speed: 1.6 }),
    walker([[1.8, 30], [1.8, 70], [-1.8, 70], [-1.8, 30], [1.8, 30]], { speed: 1.4 }),
    walker([[-14, -14], [-30, -30], [-14, -14]], { speed: 1.5 }),
    walker([[14, -14], [30, -32], [14, -14]], { speed: 1.5 }),
    walker([[14, 8], [40, 16], [14, 8]], { speed: 1.5 }),
    walker([[-14, 8], [-40, 14], [-14, 8]], { speed: 1.5 }),
    walker([[-1.4, -12], [-1.4, -26], [-1.4, -12]], { speed: 1.4 }),
    walker([[-2, 40], [-2, 90], [-2, 40]], { speed: 1.8 }),
  ];
  for (const b of B) {
    b.ride = null;
    b.walk = plans[b.i % plans.length];
  }
}
async function unboardAll() {
  for (const b of B) if (b.ride) await bots.unboard(b, b.x, b.z);
}

async function waitFor(expr, frames = 300, what = expr) {
  for (let i = 0; i < frames; i++) {
    if (await g(expr)) return true;
    await step(v, 1);
    await wait(30);
  }
  throw new Error("timed out: " + what);
}
async function leaveRide() {
  if ((await g("G.mode")) === "ride") {
    await page.keyboard.press("KeyQ");
    await waitFor("G.mode === 'walk'");
  }
}
/** Seconds from now (serverNow) until the viewer's ride first satisfies `cond(res)` (JS expr on r). */
const findTime = (cond, from = 0, to = 120) =>
  g(`(() => { const d = G.rides.get(G.ride.kind), P = G.camera.position.clone(), Q = G.camera.quaternion.clone(), n = G.serverNow();
    for (let s = ${from}; s < ${to}; s += 1 / 30) { const r = d.seatPose(G.ride, n + s * 1000, P, Q); if (${cond}) return s; } return null; })()`);

async function boardScheduled(kind, botSeats) {
  await leaveRide();
  const zone = await g(`G.rides.get('${kind}').zone`);
  await g(`G.tp(${zone.x}, ${zone.z})`);
  const next = await g(`G.nextBoarding('${kind}')`);
  if (next > 0) await g(`G.warp(${next + 0.4})`);
  await step(v, 2);
  const st = await g(`G.rides.get('${kind}').schedule.boardable(G.serverNow())`);
  await Promise.all(botSeats.map(([bi, seat]) => bots.board(B[bi], kind, st.key, st.maxSeats, st.start, seat)));
  await wait(500);
  await g("G.interact()");
  await waitFor("G.mode === 'ride'");
  return st;
}

const fixed = (pos, look, fov = 55) => `C.path({ pos: [${JSON.stringify(pos)}, ${JSON.stringify(pos.map((x) => x + 0.001))}], look: [${JSON.stringify(look)}, ${JSON.stringify(look)}], dur: 1, fov: ${fov} })`;

// ------------------------------------------------------------------ shots
const SHOTS = {
  /** Hero: from behind the gate, rise up the avenue and reveal the whole park. */
  async intro() {
    await leaveRide();
    ambient();
    await g("G.tp(-1.5, 60)");
    await ui(v, { clean: true });
    await step(v, 30);
    await cine(v, `C.path({
      pos: [[0, 3.6, 124], [0, 3.8, 110], [0, 4.4, 99], [0, 8, 86], [2, 20, 66], [6, 36, 46], [10, 46, 36]],
      look: [[0, 5, 90], [0, 5, 70], [0, 6, 40], [0, 8, 0], [-4, 8, -40], [-8, 6, -60], [-8, 6, -60]],
      dur: 12, fov: 58, fov2: 62 })`);
    await record("intro", 12, { stills: [0, 150, 330] });
  },

  /** First person on the coaster: over the crest, down the 30 m drop and through the loop. */
  async coaster() {
    ambient();
    await boardScheduled("coaster", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((s, j) => [j, s]));
    await ui(v, { clean: false, chat: false });
    await cine(v, null);
    await g("G.setCam('fp', 0, -0.32)");
    const crest = await findTime("!r.lift && r.waiting <= 0 && r.speed > 0 && d.seatPose(G.ride, n + (s - 1) * 1000, P, Q).lift");
    console.log("coaster crest in", crest?.toFixed(1), "s");
    await g(`G.warp(${crest - 1.3})`);
    await step(v, 3);
    await record("coaster-pov", 13, { stills: [70, 130, 250] });

    // the same run again, chased from outside: riders cheering through the loop
    await g(`G.warp(${-13.1 - 1})`);
    await g("G.setCam('tp', 0, -0.2)");
    await ui(v, { clean: true });
    const last = await g(`JSON.stringify({ ...G.ride, seat: 9 })`);
    await cine(v, `C.follow({ kind: 'coaster', ride: ${last}, off: [0, 4.5, -9], look: [0, 0.5, 8], fov: 62, smooth: 5 })`);
    await step(v, 3);
    await record("coaster-chase", 12, { stills: [100, 200] });

    // wide: the train screams through the loop
    await g(`G.warp(${-12.1})`);
    const loopAt = await findTime("r.speed > 0 && P.x > 0 && P.y > 10", 0, 40);
    console.log("loop in", loopAt?.toFixed(1));
    await g(`G.warp(${loopAt - 3})`);
    await cine(v, `C.path({ pos: [[30, 6, -80], [27, 6.5, -81]], look: [[6, 12, -97], [4, 11, -97]], dur: 6, fov: 50, ease: false })`);
    await step(v, 2);
    await record("coaster-loop", 6, { stills: [90] });
    await cine(v, null);
    await leaveRide();
    await unboardAll();
  },

  /** Drop tower: hang at 45 m, then fall. POV, then from the ground looking up. */
  async drop() {
    ambient();
    await boardScheduled("drop", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => [j, j + 1]));
    await ui(v, { clean: false, chat: false });
    await cine(v, null);
    const fall = await findTime("r.phase === 'fall'");
    const myRide = await g("JSON.stringify(G.ride)"); // the ride may end (and G.ride clear) during the POV take
    console.log("drop falls in", fall?.toFixed(1));
    await g(`G.warp(${fall - 3.5})`);
    await g("G.setCam('fp', 0, -0.75)");
    await step(v, 3);
    await record("drop-pov", 9, { stills: [40, 120] });

    await g(`G.warp(${-(9 + 3 / FPS) + 3.5 - 6})`); // back to 6 s before the fall
    await g("G.setCam('tp', 0, -0.2)");
    await ui(v, { clean: true });
    await cine(v, `C.track({ pos: [0.2, 1.4, -26], kind: 'drop', ride: ${myRide}, fov: 62, lookOff: [0, 3, 0], smooth: 4 })`);
    await step(v, 2);
    await record("drop-ground", 9.5, { stills: [60, 200] });
    await cine(v, null);
    await leaveRide();
    await unboardAll();
  },

  /** Ferris wheel: friends in every gondola, slow push-in while it turns. */
  async wheel() {
    ambient();
    await leaveRide();
    const zone = await g("G.rides.get('wheel').zone");
    await g(`G.tp(${zone.x}, ${zone.z})`);
    await step(v, 2);
    const now = await g("G.serverNow()");
    for (let j = 0; j < 10; j++) await bots.board(B[j], "wheel", `wheel:${j + 1}`, 4, now, j % 2);
    await g("G.interact()");
    await waitFor("G.mode === 'ride'");
    await ui(v, { clean: true });
    await cine(v, `C.path({ pos: [[48, 6, -36], [56, 14, -44]], look: [[70, 18, -70], [70, 22, -70]], dur: 8, fov: 58, ease: false })`);
    await step(v, 2);
    await record("wheel", 8, { stills: [120] });

    // on board near the top, looking out over the park
    await g("G.warp(36)");
    await cine(v, `C.follow({ kind: 'wheel', ride: ${await g("JSON.stringify(G.ride)")}, off: [5, 2.2, -6], look: [-30, -14, 30], fov: 60, smooth: 4, world: true })`);
    await step(v, 2);
    await record("wheel-top", 7, { stills: [100] });
    await cine(v, null);
    await leaveRide();
    await unboardAll();
  },

  /** Carousel with everyone on a horse. */
  async carousel() {
    ambient();
    await leaveRide();
    await g("G.tp(58, 8)");
    await step(v, 2);
    const now = await g("G.serverNow()");
    for (let j = 0; j < 11; j++) await bots.board(B[j], "carousel", `carousel:${j * 2 + 1}`, 1, now);
    await g("G.interact()");
    await waitFor("G.mode === 'ride'");
    await ui(v, { clean: true });
    await cine(v, `C.orbit({ c: [58, 0, 18], r: 17, r2: 14, h: 3.2, h2: 4.2, a0: 0.2, a1: 1.0, dur: 8, lookY: 2.2, fov: 55 })`);
    await step(v, 2);
    await record("carousel", 8, { stills: [120] });
    await cine(v, null);
    await leaveRide();
    await unboardAll();
  },

  /** Bumper cars: you drive, friends ram around you. */
  async bumper() {
    ambient();
    await leaveRide();
    const b = await g("G.bumpers.bounds");
    const zone = await g("G.rides.get('bumper').zone");
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // bots drive ellipses and figure eights
    const drivers = [0, 1, 2, 3, 4, 5];
    for (const [j, bi] of drivers.entries()) {
      const bot = B[bi];
      await bots.board(bot, "bumper", `bumper:${j + 1}`, 1, await g("G.serverNow()"));
      const ph = (j * Math.PI * 2) / drivers.length, rx = 9 - (j % 3) * 2.2, rz = 6 - (j % 2) * 2.5, w = 0.55 + (j % 3) * 0.08;
      const pos = (t) => {
        const a = ph + t * w * (j % 2 ? -1 : 1);
        return j % 3 === 2 ? [cx + Math.sin(a) * rx, cz + Math.sin(2 * a) * rz * 0.8] : [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz];
      };
      bot.walk = (t) => {
        const [x, z] = pos(t), [x2, z2] = pos(t + 0.05);
        return { x, z, ry: Math.atan2(x2 - x, z2 - z), anim: Math.sin(t * 1.3 + j) > 0.97 ? "horn" : "drive" };
      };
    }
    await g(`G.tp(${zone.x}, ${zone.z})`);
    await step(v, 10);
    await g("G.interact()");
    await waitFor("G.mode === 'ride'");
    await g("G.setCam('tp', 0, -0.3)");
    await ui(v, { clean: false, chat: false });
    await step(v, 20);
    const keys = (i) => {
      // drive: forward with some steering; short reverse to line up the next hit
      const t = i / FPS;
      const s = t % 4;
      return { W: s < 3.2, S: s >= 3.2, A: (t > 0.8 && t < 1.6) || (t > 5.5 && t < 6.2), D: (t > 2.2 && t < 2.9) || (t > 8.5 && t < 9.3) };
    };
    const down = new Set();
    await record("bumper", 11, {
      stills: [90, 200],
      async onFrame(i) {
        const k = keys(i);
        for (const [key, on] of Object.entries(k)) {
          if (on && !down.has(key)) await page.keyboard.down("Key" + key), down.add(key);
          if (!on && down.has(key)) await page.keyboard.up("Key" + key), down.delete(key);
        }
        if (i === 140) await page.keyboard.press("Space");
      },
    });
    for (const k of down) await page.keyboard.up("Key" + k);
    await leaveRide();
    for (const bi of drivers) await bots.unboard(B[bi], zone.x - 3, zone.z + 2 + bi);
  },

  /** Food carts on the avenue: people chatting with snacks and balloons. */
  async plaza() {
    await leaveRide();
    ambient();
    // a little group by the ice-cream cart, chatting
    const group = [[0, -3.5, 46, 2.4], [1, -1.5, 47.5, -2.6], [3, -3.2, 49, 2.0], [2, -0.8, 45, -2.2]];
    for (const [bi, x, z, ry] of group) await bots.place(B[bi], x, z, ry);
    await g("G.tp(9, 60)");
    await ui(v, { clean: false });
    await clearChat(v);
    await step(v, 15);
    await cine(v, `C.path({ pos: [[5.5, 2.4, 55], [4, 2.2, 51]], look: [[-2, 1.4, 45], [-2.5, 1.5, 44]], dur: 9, fov: 50, ease: false })`);
    const lines = [[10, 0, "Kem dâu ngon quá trời!"], [55, 1, "Lát đi tàu lượn không?"], [105, 3, "Đi! Mà cho mình ăn kẹo bông xong đã"], [160, 2, "Ai lên tháp rơi với mình nè"], [215, 0, "Sợ lắm á haha"]];
    await record("plaza", 9.5, {
      stills: [130, 250],
      async onFrame(i) {
        for (const [at, bi, text] of lines) if (i === at) bots.say(B[bi], text);
      },
    });
    await cine(v, null);
  },

  /** Darts: a few throws at the balloon board. */
  async darts() {
    await leaveRide();
    await g("G.tp(G.darts.standPoint.x, G.darts.standPoint.z + 0.5)");
    await step(v, 2);
    await g("G.interact()");
    await ui(v, { clean: false, chat: false });
    await step(v, 15);
    const cols = [0.32, 0.40, 0.47, 0.54, 0.61, 0.68], rows = [0.32, 0.43, 0.54, 0.66];
    const aims = [[2, 1], [4, 2], [1, 3], [3, 0], [5, 1], [0, 2], [2, 3], [4, 0], [3, 2], [1, 1], [5, 3], [0, 0]].map(([c, r]) => [cols[c] * 1920, rows[r] * 1080]);
    await record("darts", 6, {
      stills: [100],
      async onFrame(i) {
        const k = i - 8;
        if (k >= 0 && k % 13 === 0 && aims[k / 13]) await page.mouse.click(...aims[k / 13]);
      },
    });
    await page.keyboard.press("KeyQ");
  },

  /** Outro: high orbit over the whole park. */
  async outro() {
    await leaveRide();
    ambient();
    await ui(v, { clean: true });
    await cine(v, `C.orbit({ c: [-5, 0, -15], r: 150, r2: 135, h: 70, h2: 62, a0: 0.15, a1: -0.55, dur: 10, lookY: 6, fov: 50 })`);
    await step(v, 2);
    await record("outro", 10, { stills: [150] });
    await cine(v, null);
  },
};

for (const [k, fn] of Object.entries(SHOTS)) {
  if (!want(k)) continue;
  console.log("== " + k);
  try {
    await fn();
  } catch (e) {
    console.log(`!! ${k} failed:`, e.message);
    await cine(v, null).catch(() => {});
  }
}
await done(v);
process.exit(0);
