import * as THREE from "three";
import { Collider, std } from "../util";
import { PATHS, PLAZA_R } from "./park";

// Park benches you can sit on: two seats each. A seat never moves, so a sitter is placed by
// `seatPose` alone (like a clock-driven ride with no clock).

export type Bench = { x: number; z: number; /** Yaw: local +z (the way a sitter faces) in world space. */ ry: number };

const SEAT_X = 0.52; // hips, from the bench centre
const SEAT_Y = 0.6; // hip height on the plank
const SEAT_Z = 0.04;
const EXIT_Z = 1.0;

const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Where the benches go: around the plaza edge and the fountain, and along the entrance avenue. */
function layout(): Bench[] {
  const out: Bench[] = [];
  const facing = (x: number, z: number) => Math.atan2(-x, -z); // toward the fountain
  /** Angles where paths leave the plaza (keep those clear). */
  const mouths = PATHS.map((p) => p.pts[0])
    .filter(([x, z]) => Math.abs(Math.hypot(x, z) - PLAZA_R) < 2)
    .map(([x, z]) => Math.atan2(z, x))
    .sort((a, b) => a - b);
  // plaza edge, between the path mouths
  const outer: number[] = [];
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(ang) * (PLAZA_R - 2.5), z = Math.sin(ang) * (PLAZA_R - 2.5);
    if (Math.abs(x) < 6 && z > 0) continue;
    if (mouths.some((m) => angDiff(m, ang) < 0.3)) continue;
    outer.push(ang);
    out.push({ x, z, ry: facing(x, z) });
  }
  // by the fountain's flower bed, in the middle of each wide gap between paths
  for (let i = 0; i < mouths.length; i++) {
    const a = mouths[i], b = i + 1 < mouths.length ? mouths[i + 1] : mouths[0] + Math.PI * 2;
    if (b - a < 0.66) continue;
    const ang = (a + b) / 2;
    if (outer.some((o) => angDiff(o, ang) < 0.35)) continue; // not right in front of an edge bench
    const x = Math.cos(ang) * 10.4, z = Math.sin(ang) * 10.4;
    out.push({ x, z, ry: facing(x, z) });
  }
  // entrance avenue, facing across it, between the lamps
  for (const z of [30, 78, 90]) for (const s of [-1, 1]) out.push({ x: s * 6.4, z, ry: -s * Math.PI / 2 });
  return out;
}

export class Benches {
  group = new THREE.Group();
  colliders: Collider[] = [];
  readonly list = layout();
  readonly seats = 2;

  constructor() {
    const wood = std("#a0522d");
    const iron = std("#333");
    const seatGeo = new THREE.BoxGeometry(2.2, 0.12, 0.6);
    const backGeo = new THREE.BoxGeometry(2.2, 0.5, 0.1);
    const legGeo = new THREE.BoxGeometry(0.1, 0.48, 0.55);
    for (const b of this.list) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(seatGeo, wood);
      seat.position.y = 0.48;
      const back = new THREE.Mesh(backGeo, wood);
      back.position.set(0, 0.8, -0.28);
      g.add(seat, back);
      for (const lx of [-0.95, 0.95]) {
        const l = new THREE.Mesh(legGeo, iron);
        l.position.set(lx, 0.24, 0);
        g.add(l);
      }
      g.position.set(b.x, 0, b.z);
      g.rotation.y = b.ry;
      g.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.group.add(g);
      for (const s of [-1, 1]) {
        const p = this.local(b, s * 0.55, -0.05, tmp);
        this.colliders.push({ x: p.x, z: p.z, r: 0.55 });
      }
    }
  }

  /** A point given in a bench's own frame (x along the plank, +z the way it faces). */
  local(b: Bench, x: number, z: number, out: THREE.Vector3) {
    const c = Math.cos(b.ry), s = Math.sin(b.ry);
    return out.set(b.x + x * c + z * s, 0, b.z - x * s + z * c);
  }

  /** Where to stand to sit on bench i. */
  front(i: number, out = new THREE.Vector3()) {
    return this.local(this.list[i], 0, 0.95, out);
  }

  /** The nearest bench within reach of (x, z), and its seat closest to that point. */
  nearest(x: number, z: number, reach = 2.2) {
    let best = -1, bd = reach * reach;
    for (let i = 0; i < this.list.length; i++) {
      this.front(i, tmp);
      const d = (tmp.x - x) ** 2 + (tmp.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const b = this.list[best];
    // seat 0 is on the bench's local -x side
    const lx = (x - b.x) * Math.cos(b.ry) - (z - b.z) * Math.sin(b.ry);
    return { i: best, seat: lx < 0 ? 0 : 1 };
  }

  seatPose(key: string, seat: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const b = this.list[+(key.split(":")[1] ?? -1)];
    if (!b) return false;
    this.local(b, (seat ? 1 : -1) * SEAT_X, SEAT_Z, pos).y = SEAT_Y;
    quat.setFromAxisAngle(UP, b.ry);
    return true;
  }

  exitFor(key: string, seat: number, out: THREE.Vector3) {
    const b = this.list[+(key.split(":")[1] ?? 0)] ?? this.list[0];
    return this.local(b, (seat ? 1 : -1) * SEAT_X, EXIT_Z, out);
  }

  /** Keeps trees off the benches. */
  blocks(x: number, z: number) {
    return this.list.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 6.25);
  }
}

const tmp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
