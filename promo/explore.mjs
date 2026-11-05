// Renders stills from candidate cameras: node promo/explore.mjs  (E2E_URL to reuse a dev server)
import { viewer, cine, ui, step, shot, done, bots } from "./lib.mjs";
const v = await viewer({ spot: [0, 70] });
await ui(v, { clean: true });
const cams = {
  top: `C.path({ pos: [[0, 260, 20], [0, 260, 20.1]], look: [[0, 0, 0], [0, 0, 0.1]], dur: 1, fov: 60 })`,
  gate: `C.path({ pos: [[0, 25, 125], [0, 25, 125.1]], look: [[0, 5, 0], [0, 5, 0.1]], dur: 1, fov: 55 })`,
  coasterSide: `C.path({ pos: [[-40, 30, -20], [-40, 30, -20.1]], look: [[-40, 10, -90], [-40, 10, -90.1]], dur: 1, fov: 55 })`,
  wheel: `C.path({ pos: [[40, 12, -30], [40, 12, -30.1]], look: [[70, 22, -70], [70, 22, -70.1]], dur: 1, fov: 55 })`,
  bumper: `C.path({ pos: [[54, 14, 74], [54, 14, 74.1]], look: [[54, 0, 52], [54, 0, 52.1]], dur: 1, fov: 55 })`,
};
for (const [k, c] of Object.entries(cams)) {
  await cine(v, c);
  await step(v, 3);
  await shot(v, "explore-" + k);
}
console.log(await v.g(`JSON.stringify({ coaster: G.rides.get('coaster').zone, drop: G.rides.get('drop').zone, wheel: G.rides.get('wheel').zone, bumper: G.bumpers.bounds, carts: [0,1,2,3,4,5].map(i => G.cartFront(i)) })`));
await done(v);
process.exit(0);
