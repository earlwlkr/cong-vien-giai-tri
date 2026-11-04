import * as THREE from "three";
import { Collider, canvasTexture, makeSign, std } from "../util";

// Free-fall tower. Everyone sees the same carriage: its height is a pure function of server time.
// Cycle: board at the bottom → slow spinning climb → random suspense hold → free fall → magnetic brakes.

const SEATS = 12;
const R_SEAT = 2.75; // hip distance from the column axis
const BOTTOM = 1.0; // hip height when parked
const TOP = 46; // hip height at the top
const FALL_TO = 18; // free fall ends here, brakes start
const STOP_AT = 3.2; // brakes bring the carriage to rest here
const G = 9.81;

const BOARD = 15; // s at the bottom, doors open
const RISE = 22;
const HOLD_MIN = 2, HOLD_MAX = 6;
const FALL_T = Math.sqrt((2 * (TOP - FALL_TO)) / G);
const V_MAX = G * FALL_T;
const BRAKE_A = (V_MAX * V_MAX) / (2 * (FALL_TO - STOP_AT));
const BRAKE_T = V_MAX / BRAKE_A;
const LOWER = 3.5;
const UNLOAD = 2.5;
const PERIOD = Math.ceil(BOARD + RISE + HOLD_MAX + FALL_T + BRAKE_T + LOWER + UNLOAD + 1);
const COL_H = TOP + 4.5;

export type DropPhase = "board" | "rise" | "hold" | "fall" | "brake" | "lower" | "done";
export interface DropState {
  phase: DropPhase;
  y: number; // hip height
  v: number; // vertical speed, m/s (negative = down)
  g: number;
  spin: number; // carriage rotation (rad)
  waiting: number; // seconds until the climb starts (board phase)
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeD = (t: number) => (t < 0.5 ? 4 * t : 4 * (1 - t)); // derivative of ease

/** Deterministic per-cycle hold so everyone shares the same suspense. */
function holdFor(cycle: number) {
  const h = Math.sin(cycle * 127.1 + 311.7) * 43758.5453;
  return HOLD_MIN + (h - Math.floor(h)) * (HOLD_MAX - HOLD_MIN);
}

export class DropTower {
  group = new THREE.Group();
  colliders: Collider[] = [];
  center: THREE.Vector3;
  boardZone: THREE.Vector3;
  exitPoint: THREE.Vector3;
  seats = SEATS;
  readonly top = TOP;
  readonly vMax = V_MAX;
  private carriage = new THREE.Group();
  private bulbs!: THREE.InstancedMesh;
  private bulbCols: THREE.Color[] = [];

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    this.boardZone = new THREE.Vector3(x, 0, z + 7.5);
    this.exitPoint = new THREE.Vector3(x + 2.2, 0, z + 8.2);
    this.colliders.push({ x, z, r: 4.3 });
    this.build();
  }

  cycleOf(now: number) {
    const Pms = PERIOD * 1000;
    const c = Math.floor(now / Pms);
    return { cycle: c, cycleStart: c * Pms, key: `drop:${c}` };
  }

  /** Carriage state `t` seconds into cycle `cycle`. */
  state(t: number, cycle: number): DropState {
    const hold = holdFor(cycle);
    const s: DropState = { phase: "board", y: BOTTOM, v: 0, g: 1, spin: 0, waiting: 0 };
    if (t < BOARD) {
      s.waiting = BOARD - t;
      return s;
    }
    t -= BOARD;
    if (t < RISE) {
      const u = t / RISE;
      s.phase = "rise";
      s.y = BOTTOM + (TOP - BOTTOM) * ease(u);
      s.v = ((TOP - BOTTOM) * easeD(u)) / RISE;
      s.spin = ease(u) * Math.PI * 2;
      return s;
    }
    t -= RISE;
    if (t < hold) {
      s.phase = "hold";
      s.y = TOP;
      return s;
    }
    t -= hold;
    if (t < FALL_T) {
      s.phase = "fall";
      s.y = TOP - 0.5 * G * t * t;
      s.v = -G * t;
      s.g = 0;
      return s;
    }
    t -= FALL_T;
    if (t < BRAKE_T) {
      s.phase = "brake";
      s.y = FALL_TO - (V_MAX * t - 0.5 * BRAKE_A * t * t);
      s.v = -(V_MAX - BRAKE_A * t);
      s.g = 1 + BRAKE_A / G;
      return s;
    }
    t -= BRAKE_T;
    if (t < LOWER) {
      const u = t / LOWER;
      s.phase = "lower";
      s.y = STOP_AT - (STOP_AT - BOTTOM) * ease(u);
      s.v = -((STOP_AT - BOTTOM) * easeD(u)) / LOWER;
      return s;
    }
    s.phase = t < LOWER + UNLOAD ? "lower" : "done";
    return s;
  }

  stateAt(now: number) {
    const c = this.cycleOf(now);
    return { ...this.state((now - c.cycleStart) / 1000, c.cycle), ...c };
  }

  /** Current cycle if it's still boarding with ≥ minLeft seconds to go. */
  boardable(now: number, minLeft = 1.5) {
    const st = this.stateAt(now);
    return st.phase === "board" && st.waiting >= minLeft ? st : null;
  }
  /** Seconds until the next cycle starts boarding. */
  nextBoarding(now: number) {
    const c = this.cycleOf(now);
    return (c.cycleStart + PERIOD * 1000 - now) / 1000;
  }

  seatPose(key: string, seat: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const m = /^drop:(-?\d+)$/.exec(key);
    if (!m) return { ok: false, done: true };
    const c = +m[1];
    const st = this.state((now - c * PERIOD * 1000) / 1000, c);
    const a = this.seatAngle(seat % SEATS, st.spin);
    pos.set(this.center.x + Math.cos(a) * R_SEAT, st.y, this.center.z + Math.sin(a) * R_SEAT);
    quat.setFromAxisAngle(UP, Math.atan2(Math.cos(a), Math.sin(a))); // face outward
    return { ok: true, done: st.phase === "done", speed: Math.abs(st.v), g: st.g, waiting: st.waiting, height: st.y - BOTTOM, phase: st.phase };
  }

  private seatAngle(i: number, spin: number) {
    // seat 0 faces the entrance (+z)
    return Math.PI / 2 + (i * Math.PI * 2) / SEATS + spin;
  }

  update(now: number) {
    const st = this.stateAt(now);
    this.carriage.position.y = st.y;
    this.carriage.rotation.y = -st.spin;
    // chase lights run up the column during the climb, flash on the drop
    const t = now / 1000;
    const n = this.bulbCols.length;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 4);
      let on: boolean;
      if (st.phase === "fall" || st.phase === "brake") on = Math.floor(t * 12) % 2 === 0;
      else if (st.phase === "hold") on = true;
      else on = (row + Math.floor(t * 6)) % 5 < 2;
      tmpC.copy(this.bulbCols[i]).multiplyScalar(on ? 1 : 0.18);
      this.bulbs.setColorAt(i, tmpC);
    }
    this.bulbs.instanceColor!.needsUpdate = true;
  }

  private build() {
    const red = "#e63946", white = "#f8f9fa";
    // striped column
    const stripes = canvasTexture(16, 64, (g) => {
      g.fillStyle = white;
      g.fillRect(0, 0, 16, 64);
      g.fillStyle = red;
      g.fillRect(0, 0, 16, 32);
    });
    stripes.wrapT = THREE.RepeatWrapping;
    stripes.repeat.set(1, 9);
    const colMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.45, metalness: 0.25 });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, COL_H, 24), colMat);
    column.position.y = COL_H / 2;
    this.group.add(column);
    // magnetic brake fins near the bottom
    const finMat = std("#5a6475", { metalness: 0.7, roughness: 0.35 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, FALL_TO - 2, 0.7), finMat);
      fin.position.set(Math.cos(a) * 1.35, (FALL_TO - 2) / 2 + 1.6, Math.sin(a) * 1.35);
      fin.rotation.y = -a;
      this.group.add(fin);
    }
    // crown
    const crown = new THREE.Group();
    crown.position.y = COL_H;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.2, 24), std("#3a0ca3", { metalness: 0.3 }));
    cap.position.y = 1.1;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 3.2, 24), std("#ffd166", { metalness: 0.4, roughness: 0.4 }));
    roof.position.y = 3.8;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), std(white));
    ball.position.y = 5.6;
    crown.add(cap, roof, ball);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const s = makeSign("THÁP RƠI", 4.2, 1.1, "#3a0ca3", "#ffd166");
      s.position.set(Math.sin(a) * 2.3, 1.1, Math.cos(a) * 2.3);
      s.rotation.y = a;
      (s.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
      crown.add(s);
    }
    this.group.add(crown);

    // light strips up the column
    const rows = 40;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: "#fff" }), rows * 4);
    const palette = ["#ffd166", "#ff4e7a", "#2ec4b6", "#ffffff"];
    const m = new THREE.Matrix4();
    let k = 0;
    for (let r = 0; r < rows; r++) {
      const y = 2.5 + (r / (rows - 1)) * (COL_H - 4);
      const rad = 1.35 - (0.3 * y) / COL_H + 0.06;
      for (let s = 0; s < 4; s++) {
        const a = (s / 4) * Math.PI * 2;
        m.makeTranslation(Math.cos(a) * rad, y, Math.sin(a) * rad);
        this.bulbs.setMatrixAt(k, m);
        const c = new THREE.Color(palette[r % palette.length]);
        this.bulbCols.push(c);
        this.bulbs.setColorAt(k++, c);
      }
    }
    this.group.add(this.bulbs);

    // carriage: a ring around the column with outward-facing seats
    const ringMat = std("#3a86ff", { metalness: 0.45, roughness: 0.35 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.9, 32, 1, true), ringMat);
    ring.material.side = THREE.DoubleSide;
    ring.position.y = 0.25;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.35, 10, 32), std("#ffd166", { metalness: 0.5 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.7;
    const deck = new THREE.Mesh(new THREE.RingGeometry(1.45, 2.45, 32), ringMat);
    deck.rotation.x = Math.PI / 2;
    deck.position.y = -0.2;
    this.carriage.add(ring, collar, deck);
    const seatCols = ["#ff4e7a", "#ffd166", "#2ec4b6", "#8338ec"];
    const panGeo = new THREE.BoxGeometry(0.62, 0.1, 0.55);
    const backGeo = new THREE.BoxGeometry(0.62, 0.95, 0.1);
    const barGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.75, 6);
    const lapGeo = new THREE.BoxGeometry(0.55, 0.08, 0.08);
    const harnessMat = std("#ffd166", { metalness: 0.4, roughness: 0.4 });
    for (let i = 0; i < SEATS; i++) {
      const a = this.seatAngle(i, 0);
      const seat = new THREE.Group();
      // local +z points outward, origin at the rider's hip
      seat.position.set(Math.cos(a) * R_SEAT, 0, Math.sin(a) * R_SEAT);
      seat.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      const col = std(seatCols[i % seatCols.length]);
      const pan = new THREE.Mesh(panGeo, col);
      pan.position.set(0, -0.12, 0.05);
      const back = new THREE.Mesh(backGeo, col);
      back.position.set(0, 0.35, -0.3);
      seat.add(pan, back);
      for (const sx of [-0.24, 0.24]) {
        const bar = new THREE.Mesh(barGeo, harnessMat);
        bar.position.set(sx, 0.55, -0.02);
        bar.rotation.x = 0.35;
        seat.add(bar);
      }
      const lap = new THREE.Mesh(lapGeo, harnessMat);
      lap.position.set(0, 0.22, 0.2);
      seat.add(lap);
      this.carriage.add(seat);
    }
    this.carriage.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    this.group.add(this.carriage);
    column.castShadow = true;
    crown.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));

    // base: round platform, plinth and a low fence with a gap at the entrance (+z)
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7, 0.3, 40), std("#c9b79c"));
    plat.position.y = 0.15;
    plat.receiveShadow = true;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 24), std("#5a6475", { metalness: 0.5 }));
    plinth.position.y = 0.45;
    this.group.add(plat, plinth);
    const railMat = std("#ffffff");
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.42) continue; // entrance
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(Math.cos(a) * 6.5, 0.85, Math.sin(a) * 6.5);
      this.group.add(post);
      const a2 = ((i + 1) / n) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a2 - Math.PI / 2), Math.cos(a2 - Math.PI / 2))) < 0.42) continue;
      const len = 2 * 6.5 * Math.sin(Math.PI / n);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len), railMat);
      const am = (a + a2) / 2;
      rail.position.set(Math.cos(am) * 6.5 * Math.cos(Math.PI / n), 1.35, Math.sin(am) * 6.5 * Math.cos(Math.PI / n));
      rail.rotation.y = -am;
      this.group.add(rail);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();
