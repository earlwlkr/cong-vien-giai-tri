import * as THREE from "three";
import { Collider, canvasTexture, makeSign, std } from "../util";

// Chair swing ride: chairs hang on chains from a canopy that climbs the tower and spins; the chairs
// fly outward at the angle where gravity and the spin balance. Spin, height and chair angle are pure
// functions of server time. Cycle: board → spin up + rise → fly → spin down + lower → unload.

const N = 16;
const R0 = 5.4; // chain tops, from the axis
const L = 5.6; // chain length (top → hip)
const H_LOW = 6.45; // canopy height while boarding: hips just above the ground
const H_HIGH = 11.5;
const W_MAX = 1.3; // rad/s at full speed
const G = 9.81;

const BOARD = 15;
const RAMP = 9;
const HOLD = 26;
const UNLOAD = 3;
const RUN = RAMP * 2 + HOLD;
const PERIOD = Math.ceil(BOARD + RUN + UNLOAD);
const COL_H = H_HIGH + 2.6;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** ∫₀ᵘ smooth */
const smoothInt = (u: number) => (u <= 0 ? 0 : u >= 1 ? u - 0.5 : u * u * u - (u * u * u * u) / 2);

export type SwingPhase = "board" | "spin" | "done";
export interface SwingState {
  phase: SwingPhase;
  /** canopy rotation (rad) */
  rot: number;
  /** spin rate (rad/s) */
  w: number;
  /** canopy height */
  h: number;
  /** chain angle from vertical */
  phi: number;
  waiting: number;
}

/** Chain angle where gravity and the spin balance: tan φ = ω² (R0 + L sin φ) / g. */
function chainAngle(w: number) {
  let phi = 0;
  for (let i = 0; i < 12; i++) phi = Math.atan((w * w * (R0 + L * Math.sin(phi))) / G);
  return phi;
}

export class SwingRide {
  group = new THREE.Group();
  colliders: Collider[] = [];
  center: THREE.Vector3;
  boardZone: THREE.Vector3;
  exitPoint: THREE.Vector3;
  seats = N;
  private canopy = new THREE.Group();
  private chairs: THREE.Group[] = [];
  private bulbs!: THREE.InstancedMesh;
  /** World angle (x→z) of the entrance gate. */
  private gate: number;

  /** The entrance faces the plaza (the origin) unless `gate` says otherwise. */
  constructor(x: number, z: number, gate = Math.atan2(-z, -x)) {
    this.gate = gate;
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    const gx = Math.cos(gate), gz = Math.sin(gate);
    this.boardZone = new THREE.Vector3(x + gx * 14.2, 0, z + gz * 14.2);
    this.exitPoint = new THREE.Vector3(x + gx * 15 - gz * 2.4, 0, z + gz * 15 + gx * 2.4);
    this.colliders.push({ x, z, r: 12.4 });
    this.build();
  }

  cycleOf(now: number) {
    const Pms = PERIOD * 1000;
    const c = Math.floor(now / Pms);
    return { cycle: c, cycleStart: c * Pms, key: `swing:${c}` };
  }

  state(t: number): SwingState {
    const s: SwingState = { phase: "board", rot: 0, w: 0, h: H_LOW, phi: 0, waiting: Math.max(0, BOARD - t) };
    if (t < BOARD) return s;
    const u = t - BOARD;
    s.phase = u < RUN + UNLOAD ? "spin" : "done";
    if (u < RAMP) {
      s.w = W_MAX * smooth(u / RAMP);
      s.rot = W_MAX * RAMP * smoothInt(u / RAMP);
      s.h = H_LOW + (H_HIGH - H_LOW) * smooth(u / RAMP);
    } else if (u < RAMP + HOLD) {
      s.w = W_MAX;
      s.rot = W_MAX * (RAMP * 0.5 + (u - RAMP));
      s.h = H_HIGH;
    } else {
      const v = Math.min(1, (u - RAMP - HOLD) / RAMP);
      s.w = W_MAX * (1 - smooth(v));
      s.rot = W_MAX * (RAMP * 0.5 + HOLD + RAMP * (v - smoothInt(v)));
      s.h = H_HIGH - (H_HIGH - H_LOW) * smooth(v);
    }
    s.phi = chainAngle(s.w);
    return s;
  }

  stateAt(now: number) {
    const c = this.cycleOf(now);
    return { ...this.state((now - c.cycleStart) / 1000), ...c };
  }

  boardable(now: number, minLeft = 1.5) {
    const st = this.stateAt(now);
    return st.phase === "board" && st.waiting >= minLeft ? st : null;
  }
  nextBoarding(now: number) {
    const c = this.cycleOf(now);
    return (c.cycleStart + PERIOD * 1000 - now) / 1000;
  }

  /** Hip position + orientation of chair i: faces the direction of travel, leans out with the chain. */
  private chairPose(i: number, st: SwingState, pos: THREE.Vector3, quat: THREE.Quaternion, local = false) {
    const a = st.rot + (i * Math.PI * 2) / N;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r = R0 + L * Math.sin(st.phi);
    pos.set(ca * r, st.h - L * Math.cos(st.phi), sa * r);
    if (!local) pos.add(this.center);
    fwd.set(-sa, 0, ca); // d(position)/da
    up.set(-ca * Math.sin(st.phi), Math.cos(st.phi), -sa * Math.sin(st.phi)); // along the chain, toward its top
    right.crossVectors(up, fwd);
    basis.makeBasis(right, up, fwd);
    quat.setFromRotationMatrix(basis);
    return r;
  }

  seatPose(key: string, seat: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const m = /^swing:(-?\d+)$/.exec(key);
    if (!m) return { ok: false, done: true };
    const st = this.state((now - +m[1] * PERIOD * 1000) / 1000);
    const r = this.chairPose(seat % N, st, pos, quat);
    return {
      ok: true,
      done: st.phase === "done",
      speed: st.w * r,
      g: 1 / Math.cos(st.phi),
      waiting: st.waiting,
      height: pos.y,
      phase: st.phase,
      angle: st.phi,
    };
  }

  update(now: number) {
    const st = this.stateAt(now);
    this.canopy.position.y = st.h;
    this.canopy.rotation.y = -st.rot;
    this.chairs.forEach((c, i) => this.chairPose(i, st, c.position, c.quaternion, true));
    // bulbs twinkle faster with the spin
    const k = Math.floor(now / (st.w > 0.3 ? 120 : 400));
    for (let i = 0; i < this.bulbs.count; i++) {
      tmpC.set(PALETTE[(i + k) % PALETTE.length]);
      this.bulbs.setColorAt(i, tmpC);
    }
    this.bulbs.instanceColor!.needsUpdate = true;
  }

  private build() {
    const gold = std("#ffd166", { metalness: 0.5, roughness: 0.35 });
    const white = std("#f8f9fa", { metalness: 0.3, roughness: 0.4 });
    const teal = std("#2ec4b6", { metalness: 0.2, roughness: 0.5 });

    // tower: the canopy slides up it
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, COL_H, 20), teal);
    col.position.y = COL_H / 2;
    col.castShadow = true;
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.4, 0.6, 24), std("#5a6475", { metalness: 0.4 }));
    plinth.position.y = 0.3;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), gold);
    crown.position.y = COL_H + 0.4;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 10), gold);
    spire.position.y = COL_H + 1.8;
    this.group.add(col, plinth, crown, spire);
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const s = makeSign("ĐU QUAY BAY", 3.2, 0.8, "#8338ec", "#ffd166");
      s.position.set(Math.sin(a) * 1.06, COL_H - 0.9, Math.cos(a) * 1.06);
      s.rotation.y = a;
      (s.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
      this.group.add(s);
    }

    // canopy: striped umbrella roof with a scalloped valance
    this.group.add(this.canopy);
    const stripes = canvasTexture(512, 64, (g) => {
      for (let i = 0; i < 16; i++) {
        g.fillStyle = i % 2 ? "#ffffff" : "#8338ec";
        g.fillRect((i * 512) / 16, 0, 512 / 16, 64);
      }
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(R0 + 1.1, 2.4, 32, 1, true), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.7 }));
    roof.position.y = 1.5;
    const valance = new THREE.Mesh(new THREE.CylinderGeometry(R0 + 1.1, R0 + 1.1, 0.6, 40, 1, true), gold);
    valance.material.side = THREE.DoubleSide;
    valance.position.y = 0.0;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.0, 20), std("#ff4e7a"));
    this.canopy.add(roof, valance, hub);
    const spokeGeo = new THREE.BoxGeometry(R0, 0.14, 0.14);
    spokeGeo.translate(R0 / 2, 0, 0);
    for (let i = 0; i < N; i++) {
      const sp = new THREE.Mesh(spokeGeo, white);
      sp.rotation.y = -(i * Math.PI * 2) / N;
      sp.position.y = 0;
      this.canopy.add(sp);
    }
    const nb = 48;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), new THREE.MeshBasicMaterial({ color: "#fff" }), nb);
    const m = new THREE.Matrix4();
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * (R0 + 1.15), -0.35, Math.sin(a) * (R0 + 1.15));
      this.bulbs.setMatrixAt(i, m);
      this.bulbs.setColorAt(i, new THREE.Color(PALETTE[i % PALETTE.length]));
    }
    this.canopy.add(this.bulbs);
    this.canopy.traverse((o) => ((o as THREE.Mesh).isMesh && o !== this.bulbs && (o.castShadow = true)));

    // chairs: origin at the rider's hip, +z forward, +y up the chain
    const chairCols = ["#ff4e7a", "#ffd166", "#2ec4b6", "#3a86ff"];
    const panGeo = new THREE.BoxGeometry(0.6, 0.08, 0.55);
    const backGeo = new THREE.BoxGeometry(0.6, 0.7, 0.08);
    // chains run from the seat pan's front corners all the way up to the canopy rim (local y = L)
    const CH_X = 0.32, CH_Z = 0.12, CH_Y0 = -0.12;
    const chainGeo = new THREE.CylinderGeometry(0.025, 0.025, L - CH_Y0, 4);
    const armGeo = new THREE.BoxGeometry(0.05, 0.05, 0.62);
    const barGeo = new THREE.BoxGeometry(2 * CH_X + 0.05, 0.05, 0.05);
    for (let i = 0; i < N; i++) {
      const c = new THREE.Group();
      const mat = std(chairCols[i % chairCols.length]);
      const pan = new THREE.Mesh(panGeo, mat);
      pan.position.set(0, -0.12, 0.05);
      const back = new THREE.Mesh(backGeo, mat);
      back.position.set(0, 0.22, -0.26);
      c.add(pan, back);
      // armrests from the backrest forward, crossing the chains, holding the safety bar
      for (const sx of [-CH_X, CH_X]) {
        const arm = new THREE.Mesh(armGeo, gold);
        arm.position.set(sx, 0.25, 0.02);
        const ch = new THREE.Mesh(chainGeo, white);
        ch.position.set(sx, (L + CH_Y0) / 2, CH_Z);
        c.add(arm, ch);
      }
      const bar = new THREE.Mesh(barGeo, gold);
      bar.position.set(0, 0.25, 0.32);
      c.add(bar);
      c.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.group.add(c);
      this.chairs.push(c);
    }

    // ground: round deck, fence with a gate at +x
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.4, 0.2, 48), std("#c9b79c"));
    deck.position.y = 0.1;
    deck.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.5, 7.0, 48), std("#8338ec"));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.21;
    this.group.add(deck, ring);
    const railMat = std("#ffffff");
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6);
    const n = 44, R = 12.6;
    const gap = (a: number) => Math.abs(Math.atan2(Math.sin(a - this.gate), Math.cos(a - this.gate))) < 0.16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      if (gap(a)) continue;
      const post = new THREE.Mesh(postGeo, railMat);
      post.position.set(Math.cos(a) * R, 0.55, Math.sin(a) * R);
      this.group.add(post);
      if (gap(a2)) continue;
      const len = 2 * R * Math.sin(Math.PI / n);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), railMat);
      const am = (a + a2) / 2;
      rail.position.set(Math.cos(am) * R * Math.cos(Math.PI / n), 1.05, Math.sin(am) * R * Math.cos(Math.PI / n));
      rail.rotation.y = -am;
      this.group.add(rail);
    }
  }
}

const PALETTE = ["#ffd166", "#ff4e7a", "#2ec4b6", "#ffffff", "#c77dff"];
const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();
const tmpC = new THREE.Color();
