import * as THREE from "three";
import { Benches } from "../world/benches";
import type { RideDef, RideEnv } from "./types";

/** Sit on a park bench: no clock, no time limit; walking (or Q) stands you up. */
export function benchRide(env: RideEnv, benches = new Benches()): RideDef {
  const zones = benches.list.map((_, i) => ({ ...benches.front(i), r: 1.5 }));
  return {
    kind: "bench",
    label: "ngồi ghế",
    zone: { x: zones[0].x, z: zones[0].z, r: zones[0].r },
    zones: zones.map((z) => ({ x: z.x, z: z.z, r: z.r })),
    object: benches.group,
    colliders: benches.colliders,
    blocks: (x, z) => benches.blocks(x, z),
    prompt: () => `{bench} Ngồi nghỉ${env.isTouch ? "" : " (E)"}`,
    pick() {
      const n = benches.nearest(env.me.pos.x, env.me.pos.z);
      return n ? { key: `bench:${n.i}`, maxSeats: benches.seats, start: 0, seat: n.seat } : "{bench} Lại gần ghế hơn chút nhé!";
    },
    onBoard: () => env.toast(env.isTouch ? "{bench} Ngồi nghỉ chân – kéo cần đi để đứng dậy" : "{bench} Ngồi nghỉ chân – bấm WASD hoặc Q để đứng dậy", 2600),
    seatPose: (ride, _now, pos, quat) => (benches.seatPose(ride.key, ride.seat, pos, quat) ? { ok: true, done: false, speed: 0 } : { ok: false, done: true }),
    pose: () => "bench",
    exit: (ride) => benches.exitFor(ride.key, ride.seat, new THREE.Vector3()),
    exitLabel: "{back} Đứng dậy",
    standOnMove: true,
    camera: { pitch: [-0.05, -0.3] },
    hud() {
      env.setText("rideHud", "{bench} Đang ngồi nghỉ");
      env.show("rideHud", true);
    },
  };
}
