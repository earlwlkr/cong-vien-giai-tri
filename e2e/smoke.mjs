// One player walks the park: boards every ride (warping the clock past schedules), plays darts,
// buys a snack. Fails on any page error or broken step. ~1–2 min.  npm run e2e
// Only some rides:  npm run e2e -- drop bumper
import { check, finish, launch, player, shot, startServer, until, wait } from "./lib.mjs";

const only = process.argv.slice(2);
const url = await startServer();
await launch();
const p = await player(url, "Kiểm tra");
const { g, page } = p;

const kinds = await g("[...G.rides.keys()]");
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

if (!only.length || only.includes("shop")) {
  await g("(() => { const f = G.cartFront(0); G.tp(f.x, f.z); })()");
  await wait(400);
  await g("G.interact()");
  check(await g("!document.getElementById('shop').classList.contains('hidden')"), "shop: opens at a cart");
  const before = await g("G.wallet?.balance");
  await page.click("#shopItems button");
  check(await until(() => g("!!G.held"), 10000, "purchase").catch(() => false), "shop: buying puts the item in hand");
  check((await g("G.wallet?.balance")) < before, "shop: Xu deducted");
  await shot(p, "shop");
}

await finish();
