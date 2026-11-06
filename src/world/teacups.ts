import * as THREE from "three";
import { Collider, std } from "../util";

// Spinning teacups: six cups ride a big turntable and each cup spins on its own, faster and slower
// in waves. Every angle is a closed-form function of server time (no ride state anywhere).

const N_CUPS = 6;
const SEATS = 4;
const R_MAIN = 5.2; // cup centres, from the turntable axis
const R_SEAT = 0.78; // hips, from the cup's axis
const DECK = 0.5;
const W_MAIN = (Math.PI * 2) / 24; // turntable: one turn per 24 s
const W_CUP = 2.0; // mean cup spin, rad/s
const W_VAR = 1.4; // cup spin swings ±this
const W_FREQ = 0.21; // how fast the swings come and go
export const TEACUP_RIDE_S = 50;

export class Teacups {
  group = new THREE.Group();
  colliders: Collider[] = [];
  center: THREE.Vector3;
  seats = SEATS;
  readonly duration = TEACUP_RIDE_S;
  private table = new THREE.Group();
  private cups: THREE.Group[] = [];

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    this.colliders.push({ x, z, r: 8.6 });
    this.build();
  }

  mainAngle(i: number, now: number) {
    return (now / 1000) * W_MAIN + (i * Math.PI * 2) / N_CUPS;
  }
  /** Cup spin rate (rad/s); each cup has its own rhythm, alternating directions. */
  cupRate(i: number, now: number) {
    const t = now / 1000;
    return (i % 2 ? -1 : 1) * (W_CUP + W_VAR * Math.sin(t * W_FREQ + i * 1.9));
  }
  /** ∫ cupRate */
  cupAngle(i: number, now: number) {
    const t = now / 1000;
    return (i % 2 ? -1 : 1) * (W_CUP * t - (W_VAR / W_FREQ) * Math.cos(t * W_FREQ + i * 1.9)) + i;
  }

  cupCenter(i: number, now: number, out: THREE.Vector3) {
    const a = this.mainAngle(i, now);
    return out.set(this.center.x + Math.cos(a) * R_MAIN, DECK, this.center.z + Math.sin(a) * R_MAIN);
  }

  /** Cup nearest to a world point. Cups seat four, so friends can share. */
  nearestCup(x: number, z: number, now: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N_CUPS; i++) {
      this.cupCenter(i, now, tmp);
      const d = (tmp.x - x) ** 2 + (tmp.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  seatPose(key: string, seat: number, start: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const i = (+(key.split(":")[1] ?? 0) % N_CUPS + N_CUPS) % N_CUPS;
    this.cupCenter(i, now, pos);
    // world angle of this seat around the cup's centre (the cup turns with the table too)
    const s = this.cupAngle(i, now) + this.mainAngle(i, now) + ((seat % SEATS) * Math.PI * 2) / SEATS;
    pos.x += Math.cos(s) * R_SEAT;
    pos.z += Math.sin(s) * R_SEAT;
    pos.y = DECK + 0.72;
    quat.setFromAxisAngle(UP, Math.atan2(-Math.cos(s), -Math.sin(s))); // face the middle of the cup
    const w = this.cupRate(i, now) + W_MAIN;
    const elapsed = (now - start) / 1000;
    return { ok: true, done: elapsed > TEACUP_RIDE_S, speed: Math.abs(w) * R_SEAT, left: Math.max(0, TEACUP_RIDE_S - elapsed), rpm: (Math.abs(w) * 60) / (Math.PI * 2) };
  }

  /** A spot on the ground just outside the turntable, next to the rider's cup. */
  exitFor(key: string, now: number, out: THREE.Vector3) {
    const i = +(key.split(":")[1] ?? 0) % N_CUPS;
    const a = this.mainAngle(i, now);
    return out.set(this.center.x + Math.cos(a) * 10.2, 0, this.center.z + Math.sin(a) * 10.2);
  }

  update(now: number) {
    this.table.rotation.y = -(now / 1000) * W_MAIN;
    this.cups.forEach((c, i) => {
      // cup local frame lives on the table: only its own spin is added here
      c.rotation.y = -this.cupAngle(i, now);
    });
  }

  private build() {
    const gold = std("#ffd166", { metalness: 0.6, roughness: 0.3 });
    // static base + rotating table
    const base = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.6, 0.3, 48), std("#b5838d"));
    base.position.y = 0.15;
    base.receiveShadow = true;
    this.group.add(base, this.table);
    const deckTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d")!;
      g.translate(128, 128);
      for (let k = 0; k < 12; k++) {
        g.fillStyle = k % 2 ? "#fff1f5" : "#ffd6e0";
        g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 128, (k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2); g.fill();
      }
      return new THREE.CanvasTexture(c);
    })();
    deckTex.colorSpace = THREE.SRGBColorSpace;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(8.0, 8.0, 0.2, 48), [std("#e5989b"), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.8 }), std("#e5989b")]);
    deck.position.y = DECK - 0.1;
    deck.receiveShadow = true;
    this.table.add(deck);
    // centre: a giant teapot
    const potMat = std("#3a86ff", { roughness: 0.35, metalness: 0.15 });
    const pot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), potMat);
    pot.scale.y = 0.85;
    pot.position.y = DECK + 1.4;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), potMat);
    lid.position.y = DECK + 2.6;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), gold);
    knob.position.y = DECK + 3.6;
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 1.6, 10), potMat);
    spout.position.set(1.7, DECK + 1.8, 0);
    spout.rotation.z = -0.9;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.14, 8, 16, Math.PI * 1.3), potMat);
    handle.position.set(-1.6, DECK + 1.5, 0);
    handle.rotation.z = Math.PI * 0.35;
    this.table.add(pot, lid, knob, spout, handle);

    // cups
    const cupCols = ["#ff4e7a", "#ffd166", "#2ec4b6", "#8338ec", "#ff9f1c", "#06d6a0"];
    const shellGeo = new THREE.LatheGeometry(
      [[0, 0], [0.95, 0], [1.2, 0.15], [1.38, 0.5], [1.45, 0.95], [1.4, 1.05]].map(([x, y]) => new THREE.Vector2(x, y)),
      28,
    );
    const rimGeo = new THREE.TorusGeometry(1.42, 0.07, 6, 28);
    const saucerGeo = new THREE.CylinderGeometry(1.75, 1.55, 0.14, 28);
    const benchGeo = new THREE.TorusGeometry(R_SEAT + 0.05, 0.2, 6, 24);
    const wheelGeo = new THREE.TorusGeometry(0.32, 0.05, 6, 16);
    for (let i = 0; i < N_CUPS; i++) {
      const a = (i * Math.PI * 2) / N_CUPS;
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * R_MAIN, DECK, Math.sin(a) * R_MAIN);
      const saucer = new THREE.Mesh(saucerGeo, std("#ffffff"));
      saucer.position.y = 0.07;
      holder.add(saucer);
      const cup = new THREE.Group();
      cup.position.y = 0.14;
      const col = std(cupCols[i], { side: THREE.DoubleSide, roughness: 0.35 });
      const shell = new THREE.Mesh(shellGeo, col);
      const rim = new THREE.Mesh(rimGeo, gold);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.05;
      const bench = new THREE.Mesh(benchGeo, std("#fff8f0"));
      bench.rotation.x = Math.PI / 2;
      bench.position.y = 0.32;
      // dots on the outside
      for (let d = 0; d < 6; d++) {
        const da = (d / 6) * Math.PI * 2;
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 10), std("#ffffff"));
        dot.position.set(Math.cos(da) * 1.4, 0.62, Math.sin(da) * 1.4);
        dot.lookAt(dot.position.clone().multiplyScalar(2));
        cup.add(dot);
      }
      const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 8, 14, Math.PI * 1.2), col);
      hdl.position.set(1.52, 0.6, 0);
      hdl.rotation.z = -Math.PI * 0.6;
      const wheel = new THREE.Mesh(wheelGeo, gold);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.y = 0.95;
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 6), gold);
      axle.position.y = 0.48;
      cup.add(shell, rim, bench, hdl, wheel, axle);
      holder.add(cup);
      holder.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.table.add(holder);
      this.cups.push(cup);
    }
    // bunting posts around the edge
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const p = new THREE.Mesh(postGeo, std("#ffffff"));
      p.position.set(Math.cos(a) * 8.9, 1.6, Math.sin(a) * 8.9);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), gold);
      ball.position.set(Math.cos(a) * 8.9, 3.3, Math.sin(a) * 8.9);
      this.group.add(p, ball);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
