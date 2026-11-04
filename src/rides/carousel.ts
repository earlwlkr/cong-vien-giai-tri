import * as THREE from "three";
import { Carousel } from "../world/carousel";
import type { RideDef, RideEnv } from "./types";

export function carouselRide(env: RideEnv, carousel = new Carousel(58, 18)): RideDef {
  const c = carousel.center;
  return {
    kind: "carousel",
    label: "ngựa gỗ",
    place: { name: "{horse} Vòng ngựa gỗ", icon: "horse", x: c.x, z: c.z, r: 17 },
    zone: { x: c.x, z: c.z, r: 11.5 },
    object: carousel.group,
    colliders: carousel.colliders,
    blocks: (x, z) => Math.hypot(x - c.x, z - c.z) < 14,
    update: (now) => carousel.update(now),
    music: c,
    prompt: () => `{horse} Cưỡi ngựa gỗ${env.isTouch ? "" : " (E)"}`,
    pick(now) {
      const i = carousel.nearestHorse(env.me.pos.x, env.me.pos.z, now, env.takenSeats("carousel"));
      return i < 0 ? "{horse} Hết ngựa rồi!" : { key: `carousel:${i}`, maxSeats: 1, start: now };
    },
    seatPose: (ride, now, pos, quat) => carousel.seatPose(ride.key, now, pos, quat),
    pose: () => "horse",
    exit: (ride, now) => carousel.exitFor(ride.key, now, new THREE.Vector3()),
    camera: {},
  };
}
