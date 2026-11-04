import * as THREE from "three";
import { damp, dampAngle } from "../util";
import { BumperCars, CarState, N_CARS, OtherCar } from "../world/bumpers";
import { keyIndex, type RemoteView, type RideDef, type RideEnv } from "./types";

const BUMP_WORDS = ["bùm!", "rầm!", "oái!", "đụng nè!"];

/** Bumper cars: the only ride you steer. Your car runs locally; others' cars follow their streamed positions. */
export function bumperRide(env: RideEnv, cars = new BumperCars(54, 52)): RideDef {
  const c = cars.center, b = cars.bounds;
  let bumps = 0, cool = 0, hornUntil = 0;
  // remote cars: smoothed velocity, plus a briefly held peak so a rammer that already bounced
  // off on its owner's screen still hits us (see OtherCar.margin)
  const motion = new WeakMap<RemoteView, { vel: THREE.Vector3; peak: THREE.Vector3; seen: number }>();
  const claims = new Map<number, CarState & { speed: number }>();
  const others: OtherCar[] = [];
  const netPos = new THREE.Vector3();
  const motionOf = (r: RemoteView) => {
    let m = motion.get(r);
    const t = performance.now();
    if (!m || t - m.seen > 500) motion.set(r, (m = { vel: new THREE.Vector3(), peak: new THREE.Vector3(), seen: t }));
    m.seen = t;
    return m;
  };

  return {
    kind: "bumper",
    label: "xe đụng",
    place: { name: "{bumper} Xe điện đụng", icon: "bumper", x: c.x, z: c.z, r: 19 },
    zone: { x: cars.boardZone.x, z: cars.boardZone.z, r: 3.2 },
    object: cars.group,
    colliders: cars.colliders,
    boxes: cars.boxes,
    blocks: (x, z) => x > b.minX - 6 && x < b.maxX + 4 && z > b.minZ - 4 && z < b.maxZ + 4,
    drawMap(g, toMap) {
      const [ax, az] = toMap(b.minX, b.minZ), [bx, bz] = toMap(b.maxX, b.maxZ);
      g.fillStyle = "#8a93a3";
      g.fillRect(ax, az, bx - ax, bz - az);
    },
    prompt: () => `{bumper} Lái xe điện đụng${env.isTouch ? "" : " (E)"}`,
    pick(now) {
      const i = cars.freeCar(env.takenSeats("bumper"));
      return i < 0 ? "{bumper} Hết xe rồi, đợi chút nhé!" : { key: `bumper:${i}`, maxSeats: 1, start: now };
    },
    onBoard(ride) {
      cars.startDriving(keyIndex(ride.key) % N_CARS);
      bumps = 0;
      document.body.classList.add("driving"); // keeps the touch stick visible
      env.toast(env.isTouch ? "{bumper} Kéo bên trái để lái – đụng thoải mái!" : "{bumper} W/S chạy · A/D lái · Space bóp còi", 3500);
    },
    onLeave() {
      cars.stopDriving();
      document.body.classList.remove("driving");
      if (bumps > 0) env.toast(`{bumper} Bạn đã đụng ${bumps} lần – vui ghê!`, 3000);
    },

    seatPose: () => ({ ok: false, done: true }), // never clock-driven
    drive(dt, pos, quat) {
      const d = cars.drive;
      if (!d) return { ok: false, done: true };
      const mv = env.input.move();
      others.length = 0;
      const claimed = new Set<number>([d.i]);
      for (const [id, r] of env.remotes()) {
        if (r.ride?.kind !== "bumper") continue;
        claimed.add(keyIndex(r.ride.key) % N_CARS);
        const p = motionOf(r).peak;
        others.push({ x: r.pos.x, z: r.pos.z, vx: p.x, vz: p.z, margin: 0.4, id });
      }
      for (let i = 0; i < N_CARS; i++) {
        if (claimed.has(i)) continue;
        const p = cars.parked(i);
        others.push({ x: p.x, z: p.z, vx: 0, vz: 0, fixed: true });
      }
      const hit = cars.step(dt, mv.y, mv.x, others);
      if (hit.hit?.id) {
        // one hit per approach: forget the rammer's held speed once it has landed
        for (const [id, r] of env.remotes()) if (id === hit.hit.id) motion.get(r)?.peak.set(0, 0, 0);
      }
      cool -= dt;
      if (hit.impact > 1.2 && cool <= 0) {
        cool = 0.35;
        env.sfx.bump(hit.impact);
        env.shake(Math.min(0.3, hit.impact * 0.04));
        if (hit.car) {
          bumps++;
          if (hit.impact > 2.5) env.myAvatar()?.puff(BUMP_WORDS[Math.floor(Math.random() * BUMP_WORDS.length)], performance.now());
        }
      }
      if (env.input.consumeJump()) {
        env.sfx.horn();
        hornUntil = performance.now() + 700;
        env.myAvatar()?.puff("bíp bíp!", performance.now());
      }
      cars.seatPose(d, pos, quat);
      return { ok: true, done: false, speed: cars.speed() };
    },
    netState() {
      const d = cars.drive;
      return d && { pos: netPos.set(d.x, 0, d.z), ry: d.yaw, anim: performance.now() < hornUntil ? "horn" : "drive" };
    },
    follow(r, dt, pos, quat) {
      if (r.pos.distanceToSquared(r.target) > 100) r.pos.copy(r.target);
      const px = r.pos.x, pz = r.pos.z;
      r.pos.x = damp(r.pos.x, r.target.x, 10, dt);
      r.pos.z = damp(r.pos.z, r.target.z, 10, dt);
      r.pos.y = 0;
      r.yaw = dampAngle(r.yaw, r.targetYaw, 10, dt);
      const m = motionOf(r);
      if (dt > 0) {
        m.vel.x = damp(m.vel.x, (r.pos.x - px) / dt, 8, dt);
        m.vel.z = damp(m.vel.z, (r.pos.z - pz) / dt, 8, dt);
      }
      if (m.vel.lengthSq() >= m.peak.lengthSq()) m.peak.copy(m.vel);
      else m.peak.multiplyScalar(Math.exp(-dt / 0.3));
      const car: CarState = { x: r.pos.x, z: r.pos.z, yaw: r.yaw };
      claims.set(keyIndex(r.ride!.key) % N_CARS, { ...car, speed: m.vel.length() });
      cars.seatPose(car, pos, quat);
    },
    remoteAnim(r, anim, prev) {
      if (anim !== "horn" || prev === "horn") return;
      r.avatar.puff("bíp bíp!", performance.now());
      if (r.pos.distanceTo(env.me.pos) < 30) env.sfx.horn();
    },
    afterRemotes(t) {
      const d = cars.drive;
      if (d) claims.set(d.i, { ...d, speed: cars.speed() });
      cars.update(t, claims);
      claims.clear();
    },
    pose: () => "sit",
    exit: () => cars.exitPoint,
    camera: { tpMin: 4.5, floor: 0.6, pitch: [-0.1, -0.3], fov: (v) => 70 + v * 1.2 },
    hud(res) {
      const speed = res.speed ?? 0;
      env.setText("rideHud", `{bumper} ${Math.round(speed * 3.6)} km/h · Đụng ${bumps} lần`);
      env.show("rideHud", true);
      env.sfx.setWind(Math.min(0.25, speed / 30));
    },
  };
}
