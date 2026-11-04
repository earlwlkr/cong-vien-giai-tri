import { DropTower } from "../world/droptower";
import type { RideDef, RideEnv } from "./types";

export function dropRide(env: RideEnv, tower = new DropTower(0, -40)): RideDef {
  const c = tower.center;
  const E = env.isTouch ? "" : " (E)";
  let lastPhase = "", clack = 0;
  return {
    kind: "drop",
    label: "tháp rơi",
    place: { name: "{tower} Tháp rơi tự do", icon: "tower", x: c.x, z: c.z, r: 12 },
    zone: { x: tower.boardZone.x, z: tower.boardZone.z, r: 4.5 },
    object: tower.group,
    colliders: tower.colliders,
    blocks: (x, z) => Math.hypot(x - c.x, z - c.z) < 10,
    drawMap(g, toMap, pxPerM) {
      g.fillStyle = "#c9b79c";
      g.beginPath();
      g.arc(...toMap(c.x, c.z), 7 * pxPerM, 0, 7);
      g.fill();
    },
    update: (now) => tower.update(now),
    schedule: {
      boardable(now, minLeft) {
        const st = tower.boardable(now, minLeft);
        return st && { key: st.key, maxSeats: tower.seats, start: st.cycleStart, left: st.waiting };
      },
      nextBoarding: (now) => tower.nextBoarding(now),
    },
    prompt(now, queued) {
      const st = tower.boardable(now);
      if (queued) return `{hourglass} Đang chờ lượt… ${Math.ceil(tower.nextBoarding(now))}s (bấm để hủy)`;
      if (st) return `{tower} Lên tháp rơi! Khởi động sau ${Math.ceil(st.waiting)}s${E}`;
      return `{tower} Xếp hàng tháp rơi – ${Math.ceil(tower.nextBoarding(now))}s${E}`;
    },
    queuedToast: "{hourglass} Đã xếp hàng! Tới lượt là lên ngay",
    onBoard: () => (lastPhase = ""),
    seatPose: (ride, now, pos, quat) => tower.seatPose(ride.key, ride.seat, now, pos, quat),
    pose: (speed) => (speed > 8 ? "cheer" : "sit"),
    exit: () => tower.exitPoint,
    // riders face outward with the column behind them
    camera: { tpMin: 7.5, lookBack: true, shakeAbove: 8, fov: (v) => 70 + Math.min(18, v * 0.8) },
    hud(res, dt) {
      const ph = res.phase ?? "", h = Math.max(0, res.height ?? 0), speed = res.speed ?? 0;
      const falling = ph === "fall" || ph === "brake" || ph === "lower";
      if (ph !== lastPhase) {
        if (ph === "rise") { env.sfx.ding(); env.toast("{chain} Bắt đầu lên!", 1500); }
        else if (ph === "fall") { env.sfx.whoosh(); env.myAvatar()?.puff("Aaaaa!", performance.now()); }
        else if (ph === "brake") { env.sfx.clack(); setTimeout(() => env.sfx.clack(), 90); setTimeout(() => env.sfx.clack(), 180); }
        lastPhase = ph;
      }
      if (ph === "board") env.setText("rideHud", `{lock} Khởi động sau ${Math.ceil(res.waiting ?? 0)}s`);
      else if (ph === "rise") env.setText("rideHud", `{chain} Lên cao… ${h.toFixed(0)} m`);
      else if (ph === "hold") env.setText("rideHud", `{eye} ${h.toFixed(0)} m – giữ chặt nhé…`);
      env.show("rideHud", !falling);
      env.show("speedo", falling);
      if (falling) {
        env.setText("speedVal", String(Math.round(speed * 3.6)));
        env.setText("gVal", `${(res.g ?? 1).toFixed(1)} G`);
      }
      if (ph === "rise") {
        clack -= dt;
        if (clack <= 0) { env.sfx.clack(); clack = 0.45; }
      }
      env.sfx.setWind(Math.max(Math.min(1, speed / 24), (h - 25) / 60));
    },
    doneToast: "{tower} Phù! Bạn đã sống sót sau cú rơi 45m!",
  };
}
