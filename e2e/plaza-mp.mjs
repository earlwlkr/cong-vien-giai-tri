// Two players at the plaza. Both sit on the same bench (different seats); B must see A seated on
// it from the seat claim alone. A waves (streamed as an anim flag) and tosses a coin into the
// fountain: B must see the wave, A's reactions and get the coin. Shots of the water show from across the plaza.
// npm run e2e:plaza
import { check, finish, launch, player, shot, startServer, until, wait } from "./lib.mjs";

const url = await startServer();
await launch();
const a = await player(url, "Ngồi A");
const b = await player(url, "Xem B");
const remoteA = `[...G.remotes.values()].find((r) => r.name === "Ngồi A")`;

// a bench by the fountain; A sits at its left end, B at its right
const bench = await a.g("G.benches.list.findIndex((b) => Math.hypot(b.x, b.z) < 12)");
const spot = (side) => `(() => { const v = G.benches.local(G.benches.list[${bench}], ${side} * 0.6, 0.95, G.me.pos.clone()); G.tp(v.x, v.z); })()`;
await a.g(spot(-1));
await b.g(spot(1));
await wait(400);
await a.g("G.interact()");
check(await until(() => a.g("G.ride?.kind === 'bench'"), 8000, "A sits").catch(() => false), "A: sits on the bench");
await b.g("G.interact()");
check(await until(() => b.g("G.ride?.kind === 'bench'"), 8000, "B sits").catch(() => false), "B: sits on the same bench");
const [sa, sb] = [await a.g("G.ride"), await b.g("G.ride")];
check(sa.key === sb.key && sa.seat !== sb.seat, `bench: one bench, two seats (${sa.key}#${sa.seat}, ${sb.key}#${sb.seat})`);
check(sa.seat === 0 && sb.seat === 1, "bench: each sits at the end they stood by");

// B places A on A's seat
await until(() => b.g(`!!${remoteA}?.ride`), 8000, "B sees A's seat");
const off = await b.g(`(() => {
  const r = ${remoteA};
  const p = new r.avatar.group.position.constructor(), q = r.avatar.group.quaternion.clone();
  G.rides.get("bench").seatPose(r.ride, G.serverNow(), p, q);
  return Math.hypot(p.x - r.avatar.group.position.x, p.z - r.avatar.group.position.z);
})()`);
check(off < 0.05, `B: A drawn on the bench seat (off by ${off.toFixed(3)} m)`);

// A waves; B sees the flag
await a.page.keyboard.press("KeyG");
check(await until(() => b.g(`${remoteA}?.anim.endsWith("+w")`), 6000, "wave").catch(() => false), "B: sees A wave");
await b.g("G.setCam('tp', G.benches.list[" + bench + "].ry + Math.PI * 0.75, -0.25)");
await wait(300);
await shot(b, "plaza-bench-wave");

// A opens the reaction bar (R) and sends a heart (1) then a haha (3): B sees both float over A
await a.page.keyboard.press("KeyR");
check(await a.g("!document.getElementById('reactBar').classList.contains('hidden')"), "A: R opens the reaction bar");
await wait(400);
await shot(a, "plaza-react-bar");
await a.page.keyboard.press("Digit1");
check(await until(() => b.g(`${remoteA}?.anim.includes("+r0")`), 6000, "heart").catch(() => false), "B: gets A's heart");
await wait(400);
await a.page.keyboard.press("Digit3");
check(await until(() => b.g(`${remoteA}?.anim.includes("+r2")`), 6000, "haha").catch(() => false), "B: gets A's haha");
check((await b.g(`${remoteA}.avatar.reacting`)) >= 1, "B: a reaction floats over A");
await wait(250);
await shot(b, "plaza-react");
check(await until(() => b.g(`!${remoteA}?.anim.includes("+r")`), 6000, "react clears").catch(() => false), "B: the reaction flag clears");
await a.page.keyboard.press("KeyR");
check(await a.g("document.getElementById('reactBar').classList.contains('hidden')"), "A: R closes the reaction bar");

// A stands up and tosses a coin; B gets it
await a.page.keyboard.press("KeyQ");
await until(() => a.g("G.mode === 'walk'"), 4000, "A stands");
await a.g("G.tp(0, -10.5)");
await wait(300);
const coins0 = await b.g("G.fountain.coinCount");
await a.g("G.interact()");
await until(() => a.g("!G.wishing"), 10000, "A's wish");
check(await until(() => b.g(`G.fountain.coinCount === ${coins0 + 1}`), 8000, "B coin").catch(() => false), "B: A's coin lands in B's fountain");

// the water show from across the plaza (B, still seated)
await b.page.keyboard.press("KeyQ");
await until(() => b.g("G.mode === 'walk'"), 4000, "B stands");
await b.g("G.tp(0, 30)");
await b.g("G.warp(G.fountain.nextShow(G.serverNow()) + 6)");
await b.g("G.setCam('tp', Math.PI, -0.05)");
await wait(1500);
await shot(b, "plaza-show");
await finish();
