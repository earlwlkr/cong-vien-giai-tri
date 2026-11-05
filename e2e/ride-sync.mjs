// Two players: A rides the Ferris wheel, B watches. Riders on clock-driven rides only send a
// heartbeat (players.update is the hottest Convex call), so check that B still places A on the
// right seat, keeps A online past the 20 s stale cut-off, and that A barely sends updates.
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

await a.g("G.tp(G.wheel.boardZone.x, G.wheel.boardZone.z)");
await b.g("G.tp(G.wheel.boardZone.x + 6, G.wheel.boardZone.z + 6)");
await wait(400);
await a.g("G.interact()");
check(await until(() => a.g("G.ride?.kind === 'wheel'"), 15000, "A boarding").catch(() => false), "A: on the wheel");

const remoteA = `[...G.remotes.values()].find((r) => r.name === "Đu A")`;
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
await finish();
