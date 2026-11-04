// Two players in bumper cars: B rams A; both must register the hit and A must get pushed.
// Also covers remote rendering of a driven ride.  npm run e2e:bumper
import { check, finish, launch, player, shot, startServer, until, wait } from "./lib.mjs";

const url = await startServer();
await launch();
const a = await player(url, "Xe A");
const b = await player(url, "Xe B");
for (const p of [a, b]) {
  await p.g("G.tp(G.bumpers.boardZone.x, G.bumpers.boardZone.z)");
  await wait(300);
  await p.g("G.interact()");
  check(await until(() => p.g("G.ride?.kind === 'bumper'"), 15000, `${p.name} boarding`).catch(() => false), `${p.name}: got a car`);
}
check((await a.g("G.ride.key")) !== (await b.g("G.ride.key")), "different cars");

await a.g("Object.assign(G.bumpers.drive, { x: 54, z: 52, yaw: 0, vx: 0, vz: 0 })");
await wait(1500); // let B see A parked there
await b.g("Object.assign(G.bumpers.drive, { x: 48, z: 52, yaw: Math.PI / 2, vx: 6, vz: 0 })");
await b.page.keyboard.down("KeyW");
await wait(1500);
await b.page.keyboard.up("KeyW");
await wait(800);
const hud = async (p) => (await p.page.textContent("#rideHud")) ?? "";
check(/Đụng [1-9]/.test(await hud(b)), `B registered the hit (${await hud(b)})`);
check(/Đụng [1-9]/.test(await hud(a)), `A registered the hit (${await hud(a)})`);
check((await a.g("G.bumpers.drive.x")) > 54.2, "A got pushed away");
await shot(a, "bumper-mp-a");
await shot(b, "bumper-mp-b");
await finish();
