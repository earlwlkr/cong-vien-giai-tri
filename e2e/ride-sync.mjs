// Two players. A walks (B must follow A from the positions stream), then rides the Ferris wheel
// while B watches: riders on clock-driven rides only send a heartbeat (players.update is the
// hottest Convex call), so B must still place A on the right seat and keep A online past the 20 s
// stale cut-off while A barely sends updates. Finally A reloads and must resume where it got off.
// npm run e2e:ride-sync
import { check, finish, launch, player, shot, startServer, until, wait } from "./lib.mjs";

const url = await startServer();
await launch();
const a = await player(url, "Đu A");
const b = await player(url, "Xem B");

// count A's position mutations on the wire
await a.page.evaluate(() => {
  window.__updates = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    if (typeof d === "string" && d.includes("players:update")) window.__updates++;
    return send.call(this, d);
  };
});

const remoteA = `[...G.remotes.values()].find((r) => r.name === "Đu A")`;
// walking: B's view of A follows A
await a.g("G.tp(60, -50)");
await b.g("G.tp(64, -46)");
await a.page.keyboard.down("KeyW");
await wait(1500);
await a.page.keyboard.up("KeyW");
await wait(800);
const gap = await (async () => {
  const me = await a.g("({ x: G.me.pos.x, z: G.me.pos.z })");
  const r = await b.g(`(() => { const r = ${remoteA}; return r && { x: r.avatar.group.position.x, z: r.avatar.group.position.z }; })()`);
  return r ? Math.hypot(me.x - r.x, me.z - r.z) : Infinity;
})();
check(gap < 0.5, `B: walking A drawn where A is (off by ${gap.toFixed(2)} m)`);

await a.g("G.tp(G.wheel.boardZone.x, G.wheel.boardZone.z)");
await b.g("G.tp(G.wheel.boardZone.x + 6, G.wheel.boardZone.z + 6)");
await wait(400);
await a.g("G.interact()");
check(await until(() => a.g("G.ride?.kind === 'wheel'"), 15000, "A boarding").catch(() => false), "A: on the wheel");

const offSeat = () =>
  b.g(`(() => {
    const r = ${remoteA};
    if (!r?.ride) return null;
    const v = r.avatar.group.position.clone(), q = r.avatar.group.quaternion.clone();
    const hip = r.avatar.group.position.clone();
    G.rides.get("wheel").seatPose(r.ride, G.serverNow(), v, q);
    return Math.hypot(v.x - hip.x, v.z - hip.z);
  })()`);
check(await until(() => b.g(`${remoteA}?.ride?.kind === 'wheel'`), 10000, "B sees A ride").catch(() => false), "B: sees A on the wheel");

const u0 = await a.page.evaluate(() => window.__updates);
const y0 = await b.g(`${remoteA}.avatar.group.position.y`);
await wait(24000); // past the 20 s cut-off: only heartbeats keep A alive
const sent = (await a.page.evaluate(() => window.__updates)) - u0;
check(sent <= 8, `A: ${sent} position updates in 24 s of riding (heartbeat only; streaming the seat was ~175)`);
check(await b.g(`!!${remoteA}`), "B: A still online after 24 s on the ride");
check((await offSeat()) < 0.6, `B: A drawn on their seat (off by ${(await offSeat())?.toFixed(2)} m)`);
check(Math.abs((await b.g(`${remoteA}.avatar.group.position.y`)) - y0) > 0.5, "B: A's gondola moved");
await shot(b, "ride-sync-b");

// get off, reload: A comes back where it got off (spot saved from the positions row)
await a.page.keyboard.press("KeyQ");
await until(() => a.g("G.mode === 'walk'"), 5000, "A exit");
await wait(800);
const off = await a.g("({ x: G.me.pos.x, z: G.me.pos.z })");
await a.page.reload({ waitUntil: "domcontentloaded" });
await a.page.waitForFunction(() => window.__game && !document.getElementById("ui").classList.contains("hidden"));
const back = await a.g("({ x: G.me.pos.x, z: G.me.pos.z })");
check(Math.hypot(back.x - off.x, back.z - off.z) < 1.5, `A: reload resumes where it got off (${Math.hypot(back.x - off.x, back.z - off.z).toFixed(2)} m away)`);
await wait(1500);
check(await b.g(`[...G.remotes.values()].filter((r) => r.name === "Đu A").length === 1`), "B: exactly one A after the reload");
await finish();
