// One player walks the park: boards every ride (warping the clock past schedules), plays darts,
// buys a snack. Fails on any page error or broken step. ~1–2 min.  npm run e2e
// Only some rides:  npm run e2e -- drop bumper
import { check, finish, launch, player, shot, startServer, statsToday, until, wait } from "./lib.mjs";

const only = process.argv.slice(2);
const url = await startServer();
await launch();
const stats0 = statsToday();
const p = await player(url, "Kiểm tra");
const { g, page } = p;

const kinds = await g("[...G.rides.keys()]");
const boardedKinds = [];
for (const kind of kinds) {
  if (only.length && !only.includes(kind)) continue;
  const zone = await g(`G.rides.get(${JSON.stringify(kind)}).zone`);
  await g(`G.tp(${zone.x}, ${zone.z})`);
  const next = await g(`G.nextBoarding(${JSON.stringify(kind)})`);
  if (next !== null) await g(`G.warp(${next + 0.3})`); // scheduled ride: jump to the start of boarding
  await wait(400);
  const prompt = (await page.textContent("#prompt"))?.trim();
  check(!!prompt, `${kind}: prompt shows ("${prompt}")`);
  await g("G.interact()");
  const boarded = await until(() => g("G.mode === 'ride' && G.ride?.kind"), 15000, `${kind} boarding`).catch(() => null);
  check(boarded === kind, `${kind}: boarded`);
  if (!boarded) continue;
  boardedKinds.push(kind);
  if (kind === "bumper") {
    await page.keyboard.down("KeyW");
    await wait(1200);
    await page.keyboard.up("KeyW");
    check((await g("G.bumpers.drive?.z")) > (await g("G.bumpers.parked(G.bumpers.drive.i).z")) + 1, "bumper: W drives the car forward");
  } else if (next !== null) {
    await g("G.warp(25)"); // into the ride itself
  }
  await wait(1500);
  check(await g("!document.getElementById('rideHud').classList.contains('hidden') || !document.getElementById('speedo').classList.contains('hidden') || G.ride.kind === 'carousel'"), `${kind}: ride HUD visible`);
  await shot(p, `ride-${kind}`);
  await page.keyboard.press("KeyQ");
  check(await until(() => g("G.mode === 'walk'"), 5000, `${kind} exit`).catch(() => false), `${kind}: Q gets off`);
}

if (!only.length || only.includes("darts")) {
  await g("G.tp(G.darts.standPoint.x, G.darts.standPoint.z + 0.5)");
  await wait(300);
  await g("G.interact()");
  check(await g("G.mode === 'darts'"), "darts: starts");
  await page.mouse.click(400, 220);
  await wait(800);
  await shot(p, "darts");
  await page.keyboard.press("KeyQ");
  check(await g("G.mode === 'walk'"), "darts: Q quits");
}

let bought = false;
if (!only.length || only.includes("shop")) {
  await g("(() => { const f = G.cartFront(0); G.tp(f.x, f.z); })()");
  await wait(400);
  await g("G.interact()");
  check(await g("!document.getElementById('shop').classList.contains('hidden')"), "shop: opens at a cart");
  const before = await g("G.wallet?.balance");
  await page.click("#shopItems button");
  check(await until(() => g("!!G.held"), 10000, "purchase").catch(() => false), "shop: buying puts the item in hand");
  check((await g("G.wallet?.balance")) < before, "shop: Xu deducted");
  bought = true;
  await shot(p, "shop");
}

let wished = false;
if (!only.length || only.includes("fountain")) {
  // stand at the flower bed south of the fountain and toss a coin
  await g("G.tp(0, 10.5)");
  await wait(400);
  const prompt = (await page.textContent("#prompt"))?.trim();
  check(/ước/.test(prompt ?? ""), `fountain: wish prompt shows ("${prompt}")`);
  const [bal0, coins0] = [await g("G.wallet?.balance"), await g("G.fountain.coinCount")];
  await g("G.interact()");
  await wait(300);
  check(await g("G.wishing"), "fountain: wish in flight");
  await until(() => g("!G.wishing"), 10000, "wish");
  const bal1 = await g("G.wallet?.balance");
  check(bal1 === bal0 - 5 || bal1 === bal0 + 25, `fountain: wish paid (${bal0} → ${bal1})`);
  check((await g("G.fountain.coinCount")) === coins0 + 1, "fountain: coin lands in the basin");
  wished = true;
  // the water show, from the plaza
  await g("G.warp(G.fountain.nextShow(G.serverNow()) + 5)");
  await g("G.setCam('tp', Math.PI, -0.12)");
  await wait(1500);
  check((await g("G.fountain.showPhase(G.serverNow())")) >= 0, "fountain: water show running");
  await shot(p, "fountain-show");
}

if (!only.length || only.includes("bench")) {
  // sit on a bench by the fountain, wave, then walk off
  await g("(() => { const b = G.benches.list.findIndex((b) => Math.hypot(b.x, b.z) < 12); const f = G.benches.front(b); G.tp(f.x, f.z); })()");
  await wait(400);
  await g("G.interact()");
  check(await until(() => g("G.mode === 'ride' && G.ride?.kind === 'bench'"), 8000, "sit").catch(() => false), "bench: sits down");
  await page.keyboard.press("KeyG");
  await wait(900);
  await shot(p, "bench-sit");
  await page.keyboard.down("KeyW");
  check(await until(() => g("G.mode === 'walk'"), 4000, "stand").catch(() => false), "bench: walking stands you up");
  await wait(300);
  await page.keyboard.up("KeyW");
}

if (!only.length || only.includes("music")) {
  // background tune plays in the park; M / the note button switch it off and the choice sticks
  await g("G.tp(0, 30)");
  await page.keyboard.press("KeyW"); // a key press: the audio context may start
  const step0 = await g("G.sfx.bgmStep");
  await wait(1500);
  check(await g("G.sfx.ctx?.state === 'running'"), "music: audio running");
  check(await g("G.sfx.musicOn"), "music: on by default");
  check((await g("G.sfx.bgmStep")) > step0, "music: background tune is playing");
  check((await g("G.sfx.bgmGain.gain.value")) > 0.01, "music: background tune audible");
  await page.keyboard.press("KeyM");
  await wait(2500);
  check(!(await g("G.sfx.musicOn")), "music: M turns it off");
  check((await g("G.sfx.bgmGain.gain.value")) < 0.005, "music: background tune silent");
  check(await g("localStorage.getItem('cvgt-music') === '0'"), "music: choice saved");
  check(await g("document.getElementById('musicBtn').children.length > 0"), "music: button has an icon");
  await shot(p, "music-off");
  await page.click("#musicBtn");
  await wait(300);
  check(await g("G.sfx.musicOn && localStorage.getItem('cvgt-music') === '1'"), "music: button turns it back on");
}

// analytics (convex/stats.ts): the visit, every boarding and the purchase were logged
const after = statsToday();
check(after.visits > stats0.visits, `stats: visit logged (${stats0.visits} → ${after.visits})`);
for (const kind of boardedKinds) {
  const [b, a] = [stats0.boards[kind] ?? 0, after.boards[kind] ?? 0];
  check(a > b, `stats: ${kind} boarding logged (${b} → ${a})`);
}
if (wished) check((after.wishes ?? 0) > (stats0.wishes ?? 0), "stats: wish logged");
if (bought) check(Object.values(after.buys).reduce((s, n) => s + n, 0) > Object.values(stats0.buys).reduce((s, n) => s + n, 0), "stats: purchase logged");

await finish();
