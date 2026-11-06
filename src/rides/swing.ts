import { SwingRide } from "../world/swings";
import type { RideDef, RideEnv } from "./types";

export function swingRide(env: RideEnv, swings = new SwingRide(-50, 54)): RideDef {
  const c = swings.center;
  const E = env.isTouch ? "" : " (E)";
  let lastPhase = "";
  return {
    kind: "swing",
    label: "đu quay bay",
    place: { name: "{swing} Đu quay bay", icon: "swing", x: c.x, z: c.z, r: 16 },
    zone: { x: swings.boardZone.x, z: swings.boardZone.z, r: 4 },
    object: swings.group,
    colliders: swings.colliders,
    blocks: (x, z) => Math.hypot(x - c.x, z - c.z) < 15 || Math.hypot(x - swings.boardZone.x, z - swings.boardZone.z) < 5,
    drawMap(g, toMap, pxPerM) {
      g.fillStyle = "#c9b79c";
      g.beginPath();
      g.arc(...toMap(c.x, c.z), 12.4 * pxPerM, 0, 7);
      g.fill();
    },
    update: (now) => swings.update(now),
    schedule: {
      boardable(now, minLeft) {
        const st = swings.boardable(now, minLeft);
        return st && { key: st.key, maxSeats: swings.seats, start: st.cycleStart, left: st.waiting };
      },
      nextBoarding: (now) => swings.nextBoarding(now),
    },
    prompt(now, queued) {
      const st = swings.boardable(now);
      if (queued) return `{hourglass} Đang chờ lượt… ${Math.ceil(swings.nextBoarding(now))}s (bấm để hủy)`;
      if (st) return `{swing} Lên đu quay bay! Quay sau ${Math.ceil(st.waiting)}s${E}`;
      return `{swing} Xếp hàng đu quay bay – ${Math.ceil(swings.nextBoarding(now))}s${E}`;
    },
    queuedToast: "{hourglass} Đã xếp hàng! Tới lượt là lên ngay",
    onBoard: () => (lastPhase = ""),
    seatPose: (ride, now, pos, quat) => swings.seatPose(ride.key, ride.seat, now, pos, quat),
    pose: (speed) => (speed > 10 ? "cheer" : "sit"),
    exit: () => swings.exitPoint,
    camera: { tpMin: 6, tilt: true, fov: (v) => 70 + Math.min(12, v * 0.6) },
    hud(res) {
      const ph = res.phase ?? "", speed = res.speed ?? 0, h = Math.max(0, res.height ?? 0);
      if (ph !== lastPhase) {
        if (ph === "spin") { env.sfx.ding(); env.toast("{swing} Cất cánh!", 1500); }
        lastPhase = ph;
      }
      if (ph === "board") env.setText("rideHud", `{lock} Quay sau ${Math.ceil(res.waiting ?? 0)}s`);
      else env.setText("rideHud", `{swing} ${h.toFixed(0)} m · ${Math.round(speed * 3.6)} km/h`);
      env.show("rideHud", true);
      env.sfx.setWind(Math.min(1, speed / 14));
    },
    doneToast: "{swing} Hạ cánh an toàn – như chim bay!",
  };
}
