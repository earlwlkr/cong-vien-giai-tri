import { PirateShip } from "../world/pirateship";
import type { RideDef, RideEnv } from "./types";

const SCREAMS = ["Uiii!", "Aaaa!", "Á á á!", "Yeee!"];

export function shipRide(env: RideEnv, ship = new PirateShip(-64, -24)): RideDef {
  const c = ship.center;
  const E = env.isTouch ? "" : " (E)";
  let lastPhase = "", lastAngle = 0, peakCool = 0;
  return {
    kind: "ship",
    label: "thuyền hải tặc",
    place: { name: "{ship} Thuyền hải tặc", icon: "ship", x: c.x + 2, z: c.z, r: 18 },
    zone: { x: ship.boardZone.x, z: ship.boardZone.z, r: 4 },
    object: ship.group,
    colliders: ship.colliders,
    boxes: ship.boxes,
    blocks: (x, z) => x > c.x - 9 && x < c.x + 12 && z > c.z - 19 && z < c.z + 19,
    drawMap(g, toMap) {
      const [ax, az] = toMap(c.x - 4.2, c.z - 15.5), [bx, bz] = toMap(c.x + 4.2, c.z + 15.5);
      g.fillStyle = "#d9c49b";
      g.fillRect(ax, az, bx - ax, bz - az);
    },
    update: (now) => ship.update(now),
    schedule: {
      boardable(now, minLeft) {
        const st = ship.boardable(now, minLeft);
        return st && { key: st.key, maxSeats: ship.seats, start: st.cycleStart, left: st.waiting };
      },
      nextBoarding: (now) => ship.nextBoarding(now),
    },
    prompt(now, queued) {
      const st = ship.boardable(now);
      if (queued) return `{hourglass} Đang chờ thuyền… ${Math.ceil(ship.nextBoarding(now))}s (bấm để hủy)`;
      if (st) return `{ship} Lên thuyền hải tặc! Nhổ neo sau ${Math.ceil(st.waiting)}s${E}`;
      return `{ship} Xếp hàng thuyền hải tặc – ${Math.ceil(ship.nextBoarding(now))}s${E}`;
    },
    queuedToast: "{hourglass} Đã xếp hàng! Thuyền về là lên ngay",
    onBoard: () => { lastPhase = ""; lastAngle = 0; },
    seatPose: (ride, now, pos, quat) => ship.seatPose(ride.key, ride.seat, now, pos, quat),
    pose: (speed) => (speed > 9 ? "cheer" : "sit"),
    exit: () => ship.exitPoint,
    camera: { tpMin: 8, tilt: true, fov: (v) => 70 + Math.min(14, v * 0.8) },
    hud(res, dt) {
      const ph = res.phase ?? "", a = res.angle ?? 0, speed = res.speed ?? 0;
      if (ph !== lastPhase) {
        if (ph === "swing") { env.sfx.ding(); env.toast("{ship} Nhổ neo! Giữ chặt tay vịn nhé", 1800); }
        lastPhase = ph;
      }
      // weightless moment at the top of a big swing
      peakCool -= dt;
      const top = Math.abs(a) > ship.maxAngle * 0.8 && Math.abs(a) < Math.abs(lastAngle);
      if (top && peakCool <= 0) {
        peakCool = 3;
        env.sfx.whoosh();
        env.myAvatar()?.puff(SCREAMS[Math.floor(Math.random() * SCREAMS.length)], performance.now());
      }
      lastAngle = a;
      if (ph === "board") env.setText("rideHud", `{lock} Nhổ neo sau ${Math.ceil(res.waiting ?? 0)}s`);
      else env.setText("rideHud", `{ship} Lắc ${Math.round(Math.abs((a * 180) / Math.PI))}° · ${(res.g ?? 1).toFixed(1)} G`);
      env.show("rideHud", true);
      env.show("speedo", false);
      env.sfx.setWind(Math.min(1, speed / 16));
    },
    doneToast: "{ship} Cập bến! Có ai say sóng không?",
  };
}
