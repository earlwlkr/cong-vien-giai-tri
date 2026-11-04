import { FerrisWheel } from "../world/ferris";
import type { RideDef, RideEnv } from "./types";

export function wheelRide(env: RideEnv, wheel = new FerrisWheel(70, -70)): RideDef {
  const c = wheel.center;
  return {
    kind: "wheel",
    label: "vòng quay",
    place: { name: "{wheel} Vòng quay mặt trời", icon: "wheel", x: c.x, z: c.z + 4, r: 24 },
    zone: { x: wheel.boardZone.x, z: wheel.boardZone.z, r: 5 },
    object: wheel.group,
    colliders: wheel.colliders,
    blocks: (x, z) => Math.abs(x - c.x) < 22 && Math.abs(z - c.z) < 12,
    update: (now) => wheel.update(now),
    prompt: () => `{wheel} Lên vòng quay mặt trời${env.isTouch ? "" : " (E)"}`,
    pick: (now) => ({ key: `wheel:${wheel.bottomGondola(now)}`, maxSeats: wheel.seats, start: now }),
    seatPose: (ride, now, pos, quat) => wheel.seatPose(ride.key, ride.seat, ride.start, now, pos, quat),
    pose: () => "sit",
    exit: () => wheel.exitPoint,
    camera: { tpMin: 8 },
    hud(res) {
      env.setText("rideHud", `{wheel} ${Math.max(0, res.height ?? 0).toFixed(0)} m · ${Math.ceil(res.left ?? 0)}s`);
      env.show("rideHud", true);
      env.sfx.setWind(Math.max(0, ((res.height ?? 0) - 15) / 40));
    },
    doneToast: "{wheel} Hết một vòng – cảnh đẹp không?",
  };
}
