import { Coaster, SEATS } from "../world/coaster";
import type { RideDef, RideEnv } from "./types";

export function coasterRide(env: RideEnv, coaster = new Coaster()): RideDef {
  // tree keep-out: 4 m cells along the track, plus the station
  const cells = new Set<string>();
  for (const s of coaster.xzSamples) {
    const cx = Math.floor(s.x / 4), cz = Math.floor(s.z / 4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cells.add(`${cx + a},${cz + b}`);
  }
  let lastWaiting = 0, clack = 0;
  const E = env.isTouch ? "" : " (E)";
  return {
    kind: "coaster",
    label: "tàu lượn",
    place: { name: "{coaster} Tàu lượn siêu tốc", icon: "coaster", x: -90, z: -95, r: 22 },
    zone: { x: coaster.boardZone.x, z: coaster.boardZone.z, r: 7 },
    object: coaster.group,
    colliders: coaster.colliders,
    blocks: (x, z) => cells.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`) || (x > -106 && x < -78 && z > -104 && z < -90),
    drawMap(g, toMap) {
      g.strokeStyle = "#e63946";
      g.lineWidth = 1.5;
      g.beginPath();
      coaster.xzSamples.forEach((s, i) => (i % 4 ? 0 : i ? g.lineTo(...toMap(s.x, s.z)) : g.moveTo(...toMap(s.x, s.z))));
      g.closePath();
      g.stroke();
    },
    update: (now) => coaster.update(now),
    schedule: {
      boardable(now, minLeft) {
        const st = coaster.boardable(now, minLeft);
        return st && { key: st.key, maxSeats: SEATS, start: st.cycleStart, left: st.dwellLeft };
      },
      nextBoarding: (now) => coaster.nextBoarding(now),
    },
    prompt(now, queued) {
      const st = coaster.boardable(now);
      if (queued) return `{hourglass} Đang chờ tàu… ${Math.ceil(coaster.nextBoarding(now))}s (bấm để hủy)`;
      if (st) return `{coaster} Lên tàu lượn! Tàu chạy sau ${Math.ceil(st.dwellLeft)}s${E}`;
      return `{coaster} Xếp hàng chờ tàu – ${Math.ceil(coaster.nextBoarding(now))}s${E}`;
    },
    queuedToast: "{hourglass} Đã xếp hàng! Tàu tới là lên ngay",
    onBoard: () => (lastWaiting = 0),
    seatPose: (ride, now, pos, quat) => coaster.seatPose(ride.key, ride.seat, now, pos, quat),
    pose: (speed) => (speed > 13 ? "cheer" : "sit"),
    exit: () => coaster.exitPoint,
    camera: { tpMin: 7.5, tilt: true, shakeAbove: 8, fov: (v) => 70 + Math.min(20, v * 0.75) },
    hud(res, dt) {
      const waiting = res.waiting ?? 0, speed = res.speed ?? 0;
      if (waiting > 0) {
        env.setText("rideHud", `{lock} Khởi hành sau ${Math.ceil(waiting)}s`);
        env.show("rideHud", true);
        env.show("speedo", false);
      } else {
        if (lastWaiting > 0) {
          env.sfx.ding();
          env.toast("{rocket} Xuất phát!", 1500);
        }
        env.show("rideHud", !!res.lift);
        if (res.lift) env.setText("rideHud", "{chain} Lên dốc 30m…");
        env.show("speedo", true);
        env.setText("speedVal", String(Math.round(speed * 3.6)));
        env.setText("gVal", `${(res.g ?? 1).toFixed(1)} G`);
      }
      lastWaiting = waiting;
      env.sfx.setWind(Math.max(0, Math.min(1, (speed - 3) / 22)));
      if (res.lift) {
        clack -= dt;
        if (clack <= 0) { env.sfx.clack(); clack = 0.22; }
      }
    },
    doneToast: "{party} Tuyệt vời! Bạn đã chinh phục tàu lượn siêu tốc!",
  };
}
