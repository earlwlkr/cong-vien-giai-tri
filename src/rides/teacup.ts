import * as THREE from "three";
import { Teacups } from "../world/teacups";
import type { RideDef, RideEnv } from "./types";

export function teacupRide(env: RideEnv, cups = new Teacups(100, 78)): RideDef {
  const c = cups.center;
  return {
    kind: "teacup",
    label: "tách trà",
    place: { name: "{teacup} Tách trà xoay", icon: "teacup", x: c.x, z: c.z, r: 14 },
    zone: { x: c.x, z: c.z, r: 11 },
    object: cups.group,
    colliders: cups.colliders,
    blocks: (x, z) => Math.hypot(x - c.x, z - c.z) < 12.5,
    drawMap(g, toMap, pxPerM) {
      g.fillStyle = "#e5989b";
      g.beginPath();
      g.arc(...toMap(c.x, c.z), 8.4 * pxPerM, 0, 7);
      g.fill();
    },
    update: (now) => cups.update(now),
    prompt: () => `{teacup} Ngồi tách trà xoay${env.isTouch ? "" : " (E)"}`,
    // nearest cup; four seats each, so friends end up together
    pick: (now) => ({ key: `teacup:${cups.nearestCup(env.me.pos.x, env.me.pos.z, now)}`, maxSeats: cups.seats, start: now }),
    onBoard: () => env.toast("{teacup} Xoay xoay xoay… đừng chóng mặt nhé!", 2500),
    seatPose: (ride, now, pos, quat) => cups.seatPose(ride.key, ride.seat, ride.start, now, pos, quat),
    pose: (speed) => (speed > 2.6 ? "cheer" : "sit"),
    exit: (ride, now) => cups.exitFor(ride.key, now, new THREE.Vector3()),
    camera: { tpMin: 4.5, pitch: [-0.15, -0.5] },
    hud(res) {
      env.setText("rideHud", `{teacup} ${Math.round(res.rpm ?? 0)} vòng/phút · ${Math.ceil(res.left ?? 0)}s`);
      env.show("rideHud", true);
      env.sfx.setWind(0);
    },
    doneToast: "{teacup} Hết lượt rồi – đi thẳng được không?",
  };
}
