import * as THREE from "three";
import { Collider, makeSign, std } from "../util";

export const COASTER_ORIGIN = new THREE.Vector3(-100, 0, -100);

// Local control points (x, y, z). Closed loop, s = 0 at the station.
const CTRL: [number, number, number][] = [
  [0, 0.6, 0], [8, 0.6, 0], [16, 0.6, 0], [24, 1.8, 0], [34, 8.5, 0], [46, 20.5, 0], [54, 28, 0], [58, 29.8, 0], [62, 29.4, 0],
  // first drop
  [66, 26, 0], [72, 15, 0], [78, 6.5, 0], [86, 3.0, 0], [96, 2.8, 0],
  // vertical loop (shifted sideways so it doesn't hit itself)
  [106, 3.3, 0], [112.4, 5.9, 0.75], [115, 12.3, 1.5], [112.4, 18.7, 2.25], [106, 21.3, 3], [99.6, 18.7, 3.75], [97, 12.3, 4.5], [99.6, 5.9, 5.25], [106, 3.3, 6],
  // banked turn
  [118, 3.4, 6.6], [128, 5, 12], [133, 8, 22], [130, 12, 33], [120, 14, 41], [106, 12, 46],
  // airtime hills
  [93, 5, 48], [82, 13, 48], [71, 4.5, 48], [60, 10, 48], [50, 3.8, 47],
  // return sweep
  [36, 5, 46], [22, 7, 43], [8, 7, 40], [-6, 5, 35], [-16, 4, 26], [-21, 2.8, 15], [-17, 1.6, 5], [-9, 0.75, 0.6],
];

const DS = 0.5; // sample spacing (m)
const G = 9.81;
export const SEATS = 10;
const CARS = 5;
const CAR_GAP = 2.4;
const STOP_S = 14; // front of train when parked
const DWELL = 12; // seconds at the station

export interface FrameOut {
  pos: THREE.Vector3;
  T: THREE.Vector3;
  U: THREE.Vector3;
  B: THREE.Vector3;
}

export interface SeatResult {
  ok: boolean;
  done: boolean;
  speed: number;
  g: number;
  waiting: number; // seconds until departure when parked, else 0
  lift: boolean;
}

export class Coaster {
  group = new THREE.Group();
  colliders: Collider[] = [];
  L = 0;
  N = 0;
  P!: Float32Array;
  T!: Float32Array;
  U!: Float32Array;
  K!: Float32Array; // curvature vector
  runS!: Float32Array; // s (unwrapped, starting at STOP_S) per 1/60 s
  runV!: Float32Array;
  runDuration = 0;
  period = 0;
  liftStart = 0;
  crestS = 0;
  trains: THREE.Group[][] = [];
  boardZone = new THREE.Vector3();
  exitPoint = new THREE.Vector3();
  xzSamples: { x: number; z: number }[] = [];

  constructor() {
    const pts = CTRL.map(([x, y, z]) => new THREE.Vector3(x, y, z).add(COASTER_ORIGIN));
    const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    this.L = curve.getLength();
    this.N = Math.floor(this.L / DS);
    const N = this.N;
    const P = (this.P = new Float32Array(N * 3));
    const T = (this.T = new Float32Array(N * 3));
    const U = (this.U = new Float32Array(N * 3));
    const K = (this.K = new Float32Array(N * 3));
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      curve.getPointAt(i / N, tmp);
      tmp.toArray(P, i * 3);
    }
    const v3 = (a: Float32Array, i: number, o = new THREE.Vector3()) => o.fromArray(a, ((i % N) + N) % N * 3);
    // tangents (central differences)
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      v3(P, i + 1, a).sub(v3(P, i - 1, b)).normalize().toArray(T, i * 3);
    }
    for (let i = 0; i < N; i++) {
      v3(T, i + 1, a).sub(v3(T, i - 1, b)).divideScalar(2 * DS).toArray(K, i * 3);
    }
    // section boundaries
    let maxY = -1;
    for (let i = 0; i < N; i++) {
      const s = i * DS;
      if (!this.liftStart && P[i * 3 + 1] - COASTER_ORIGIN.y > 1.0 && s > 16) this.liftStart = s;
      if (s < this.L * 0.3 && P[i * 3 + 1] > maxY) {
        maxY = P[i * 3 + 1];
        this.crestS = s;
      }
    }
    // free-running speed per sample (for banking)
    const speedFree = new Float32Array(N);
    for (let i = 0; i < N; i++) speedFree[i] = this.speedAt(Math.max(i * DS, STOP_S) + (i * DS < STOP_S ? this.L : 0));

    // Rotation-minimizing frames
    const up = new THREE.Vector3(0, 1, 0);
    const t = new THREE.Vector3();
    const rmf: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      v3(T, i, t);
      up.addScaledVector(t, -up.dot(t)).normalize();
      rmf.push(up.clone());
    }
    // close the loop: distribute twist
    v3(T, 0, t);
    const u0 = rmf[0], uN = rmf[N];
    const cross = new THREE.Vector3().crossVectors(uN, u0);
    const twist = Math.atan2(cross.dot(t), uN.dot(u0));
    const q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      v3(T, i, t);
      q.setFromAxisAngle(t, (twist * i) / N);
      rmf[i].applyQuaternion(q);
    }
    // banking from lateral (horizontal) acceleration
    const raw: THREE.Vector3[] = [];
    const k = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      v3(T, i, t);
      v3(K, i, k);
      k.y = 0;
      const v = speedFree[i];
      const lat = k.multiplyScalar(Math.min(v * v, 600)).addScaledVector(t, -k.dot(t));
      if (lat.length() > 14) lat.setLength(14);
      const u = rmf[i].clone().multiplyScalar(G).add(lat);
      u.addScaledVector(t, -u.dot(t)).normalize();
      raw.push(u);
    }
    // smooth
    const W = 8;
    for (let i = 0; i < N; i++) {
      const acc = new THREE.Vector3();
      for (let j = -W; j <= W; j++) acc.add(raw[(i + j + N) % N]);
      v3(T, i, t);
      acc.addScaledVector(t, -acc.dot(t)).normalize();
      acc.toArray(U, i * 3);
    }

    // run profile
    const dt = 1 / 60;
    const end = STOP_S + this.L;
    const sArr: number[] = [STOP_S];
    const vArr: number[] = [0];
    let s = STOP_S;
    while (s < end && sArr.length < 60 * 400) {
      const v = this.speedAt(s);
      s = Math.min(end, s + v * dt);
      sArr.push(s);
      vArr.push(v);
    }
    this.runS = Float32Array.from(sArr);
    this.runV = Float32Array.from(vArr);
    this.runDuration = (sArr.length - 1) * dt;
    this.period = this.runDuration + DWELL;

    for (let i = 0; i < N; i++) this.xzSamples.push({ x: P[i * 3], z: P[i * 3 + 2] });

    this.buildTrack();
    this.buildStation();
    this.trains = [this.buildTrain("#e63946", "#ffd166"), this.buildTrain("#3a86ff", "#2ec4b6")];
  }

  /** Speed (m/s) at unwrapped run distance s ∈ [STOP_S, STOP_S + L]. */
  speedAt(s: number) {
    const end = STOP_S + this.L;
    const h = this.heightAt(s % this.L);
    let v: number;
    if (s < this.liftStart) v = Math.min(3.5, Math.sqrt(0.36 + 2 * 1.5 * (s - STOP_S)));
    else if (s <= this.crestS) v = 4.2;
    else {
      const hc = this.heightAt(this.crestS);
      const v2 = 4.2 * 4.2 + 2 * G * (hc - h) - 2 * 0.018 * G * (s - this.crestS);
      v = Math.sqrt(Math.max(v2, 4));
    }
    const rem = Math.max(0, end - s);
    v = Math.min(v, Math.sqrt(2 * 3.5 * rem + 0.3), Math.sqrt(2 * 0.9 * rem + 0.3));
    return Math.max(v, 0.35);
  }

  heightAt(s: number) {
    const f = (((s / DS) % this.N) + this.N) % this.N;
    const i = Math.floor(f);
    const a = f - i;
    const j = (i + 1) % this.N;
    return this.P[i * 3 + 1] * (1 - a) + this.P[j * 3 + 1] * a;
  }

  frameAt(s: number, out: FrameOut) {
    const N = this.N;
    const f = (((s / DS) % N) + N) % N;
    const i = Math.floor(f);
    const a = f - i;
    const j = (i + 1) % N;
    const lerp = (arr: Float32Array, o: THREE.Vector3) =>
      o.set(
        arr[i * 3] * (1 - a) + arr[j * 3] * a,
        arr[i * 3 + 1] * (1 - a) + arr[j * 3 + 1] * a,
        arr[i * 3 + 2] * (1 - a) + arr[j * 3 + 2] * a,
      );
    lerp(this.P, out.pos);
    lerp(this.T, out.T).normalize();
    lerp(this.U, out.U);
    out.U.addScaledVector(out.T, -out.U.dot(out.T)).normalize();
    out.B.crossVectors(out.U, out.T).normalize();
    return out;
  }

  gAt(s: number, v: number) {
    const N = this.N;
    const i = Math.floor((((s / DS) % N) + N) % N);
    const kx = this.K[i * 3], ky = this.K[i * 3 + 1], kz = this.K[i * 3 + 2];
    const ux = this.U[i * 3], uy = this.U[i * 3 + 1], uz = this.U[i * 3 + 2];
    return ((kx * ux + ky * uy + kz * uz) * v * v + G * uy) / G;
  }

  private runAt(t: number) {
    const f = Math.max(0, t * 60);
    const i = Math.min(this.runS.length - 1, Math.floor(f));
    const j = Math.min(this.runS.length - 1, i + 1);
    const a = f - i;
    return { s: this.runS[i] * (1 - a) + this.runS[j] * a, v: this.runV[i] * (1 - a) + this.runV[j] * a };
  }

  /** Train k (0/1) state at server time `now` (ms). */
  trainState(k: number, now: number) {
    const Pms = this.period * 1000;
    const off = (k * Pms) / 2;
    const c = Math.floor((now - off) / Pms);
    const cycleStart = c * Pms + off;
    return { ...this.cycleState((now - cycleStart) / 1000), key: `coaster:${k}:${c}`, cycleStart, k };
  }

  cycleState(elapsed: number) {
    if (elapsed < DWELL) return { s: STOP_S, v: 0, dwellLeft: DWELL - elapsed, done: false };
    if (elapsed - DWELL >= this.runDuration) return { s: STOP_S, v: 0, dwellLeft: 0, done: true };
    const r = this.runAt(elapsed - DWELL);
    return { s: r.s, v: r.v, dwellLeft: 0, done: false };
  }

  /** Find a train currently boarding (parked with ≥ minLeft seconds left). */
  boardable(now: number, minLeft = 1.5) {
    for (let k = 0; k < 2; k++) {
      const st = this.trainState(k, now);
      if (st.dwellLeft >= minLeft) return st;
    }
    return null;
  }
  /** Seconds until next train starts boarding. */
  nextBoarding(now: number) {
    let best = Infinity;
    for (let k = 0; k < 2; k++) {
      const st = this.trainState(k, now);
      const toNext = st.cycleStart + this.period * 1000 - now;
      best = Math.min(best, toNext / 1000);
    }
    return best;
  }

  private carS(sFront: number, car: number) {
    return sFront - 1.1 - car * CAR_GAP;
  }

  /** Seat pose for a rider. Returns hip position + orientation (forward +Z, up +Y). */
  seatPose(key: string, seat: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion): SeatResult {
    const m = /^coaster:(\d):(-?\d+)$/.exec(key);
    if (!m) return { ok: false, done: true, speed: 0, g: 1, waiting: 0, lift: false };
    const k = +m[1], c = +m[2];
    const Pms = this.period * 1000;
    const cycleStart = c * Pms + (k * Pms) / 2;
    const st = this.cycleState((now - cycleStart) / 1000);
    const car = Math.floor(seat / 2) % CARS;
    const side = seat % 2 === 0 ? 1 : -1;
    const cs = this.carS(st.s, car);
    const f = this.frameAt(cs, this.tmpFrame);
    pos.copy(f.pos).addScaledVector(f.U, 0.62).addScaledVector(f.B, side * 0.36).addScaledVector(f.T, -0.25);
    this.tmpM.makeBasis(f.B, f.U, f.T);
    quat.setFromRotationMatrix(this.tmpM);
    const sMod = cs % this.L;
    return {
      ok: true,
      done: st.done,
      speed: st.v,
      g: st.v > 0.5 ? this.gAt(cs, st.v) : 1,
      waiting: st.dwellLeft,
      lift: sMod > this.liftStart && sMod < this.crestS && st.dwellLeft <= 0,
    };
  }
  private tmpFrame: FrameOut = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), B: new THREE.Vector3() };
  private tmpM = new THREE.Matrix4();

  update(now: number) {
    for (let k = 0; k < this.trains.length; k++) {
      const st = this.trainState(k, now);
      this.trains[k].forEach((car, j) => {
        const f = this.frameAt(this.carS(st.s, j), this.tmpFrame);
        this.tmpM.makeBasis(f.B, f.U, f.T).setPosition(f.pos);
        car.matrix.copy(this.tmpM);
        car.matrixWorldNeedsUpdate = true;
      });
    }
  }

  // ---------- geometry ----------
  private tube(ox: number, oy: number, r: number, radial: number, mat: THREE.Material, step = 1) {
    const N = this.N;
    const rings = Math.ceil(N / step);
    const pos = new Float32Array(rings * radial * 3);
    const nor = new Float32Array(rings * radial * 3);
    const idx: number[] = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3(), u = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (let ri = 0; ri < rings; ri++) {
      const i = ri * step;
      p.fromArray(this.P, i * 3);
      t.fromArray(this.T, i * 3);
      u.fromArray(this.U, i * 3);
      b.crossVectors(u, t).normalize();
      p.addScaledVector(b, ox).addScaledVector(u, oy);
      for (let k = 0; k < radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        n.copy(b).multiplyScalar(Math.cos(ang)).addScaledVector(u, Math.sin(ang));
        const o = (ri * radial + k) * 3;
        pos[o] = p.x + n.x * r;
        pos[o + 1] = p.y + n.y * r;
        pos[o + 2] = p.z + n.z * r;
        nor[o] = n.x; nor[o + 1] = n.y; nor[o + 2] = n.z;
      }
    }
    for (let ri = 0; ri < rings; ri++) {
      const rj = (ri + 1) % rings;
      for (let k = 0; k < radial; k++) {
        const k2 = (k + 1) % radial;
        const a = ri * radial + k, b2 = ri * radial + k2, c = rj * radial + k, d = rj * radial + k2;
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildTrack() {
    const rail = std("#d9dde3", { metalness: 0.6, roughness: 0.35 });
    const spine = std("#e63946", { metalness: 0.3, roughness: 0.5 });
    this.tube(0.55, 0, 0.075, 8, rail);
    this.tube(-0.55, 0, 0.075, 8, rail);
    this.tube(0, -0.42, 0.2, 10, spine, 2);

    // ties
    const step = 2; // every 1 m
    const count = Math.floor(this.N / step);
    const tieGeo = new THREE.BoxGeometry(1.3, 0.1, 0.16);
    const ties = new THREE.InstancedMesh(tieGeo, spine, count);
    const webGeo = new THREE.BoxGeometry(0.1, 0.42, 0.12);
    const webs = new THREE.InstancedMesh(webGeo, spine, count);
    const m = new THREE.Matrix4();
    const f: FrameOut = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), B: new THREE.Vector3() };
    for (let c = 0; c < count; c++) {
      this.frameAt(c * step * DS, f);
      m.makeBasis(f.B, f.U, f.T).setPosition(f.pos.clone().addScaledVector(f.U, -0.1));
      ties.setMatrixAt(c, m);
      m.makeBasis(f.B, f.U, f.T).setPosition(f.pos.clone().addScaledVector(f.U, -0.3));
      webs.setMatrixAt(c, m);
    }
    ties.castShadow = webs.castShadow = true;
    this.group.add(ties, webs);

    // supports
    const supMat = std("#f1f3f5", { metalness: 0.4, roughness: 0.4 });
    const supGeo = new THREE.CylinderGeometry(0.18, 0.24, 1, 8);
    supGeo.translate(0, 0.5, 0);
    const footGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.3, 10);
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < this.N; i += 9) {
      this.frameAt(i * DS, f);
      if (f.U.y < 0.55) continue;
      const base = f.pos.clone().addScaledVector(f.U, -0.55);
      if (base.y < 1.4) continue;
      // don't plant a support through another piece of track
      let blocked = false;
      for (let j = 0; j < this.N; j += 2) {
        if (Math.abs(j - i) < 30) continue;
        const dx = this.P[j * 3] - base.x, dz = this.P[j * 3 + 2] - base.z, y = this.P[j * 3 + 1];
        if (dx * dx + dz * dz < 2.2 && y < base.y) { blocked = true; break; }
      }
      if (blocked) continue;
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(base.x, 0, base.z), new THREE.Quaternion(), new THREE.Vector3(1, base.y, 1)));
      this.colliders.push({ x: base.x, z: base.z, r: 0.45 });
    }
    const sup = new THREE.InstancedMesh(supGeo, supMat, mats.length);
    const feet = new THREE.InstancedMesh(footGeo, std("#9aa0a6"), mats.length);
    mats.forEach((mm, i) => {
      sup.setMatrixAt(i, mm);
      const p = new THREE.Vector3().setFromMatrixPosition(mm);
      feet.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0.15, p.z));
    });
    sup.castShadow = true;
    this.group.add(sup, feet);
  }

  private buildStation() {
    const O = COASTER_ORIGIN;
    const g = new THREE.Group();
    g.position.copy(O);
    // platform floor (flush with ground)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 6), std("#c9b79c"));
    floor.position.set(8, 0.03, 4.0);
    floor.receiveShadow = true;
    const line = new THREE.Mesh(new THREE.BoxGeometry(20, 0.11, 0.25), std("#ffd166"));
    line.position.set(8, 0.04, 1.3);
    // roof
    const roofMat = std("#e63946");
    const roof = new THREE.Mesh(new THREE.BoxGeometry(22, 0.35, 9), roofMat);
    roof.position.set(8, 4.6, 2.4);
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.2, 9.4), std("#ffffff"));
    roof2.position.set(8, 4.85, 2.4);
    g.add(floor, line, roof, roof2);
    const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 4.6, 8);
    const postMat = std("#ffffff");
    for (const x of [-2, 6, 12, 18]) for (const z of [-1.6, 6.4]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(x, 2.3, z);
      g.add(p);
      this.colliders.push({ x: O.x + x, z: O.z + z, r: 0.35 });
    }
    // railings at the platform back
    const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.08, 0.08), postMat);
    rail.position.set(8, 1.0, 6.4);
    g.add(rail);
    const sign = makeSign("TÀU LƯỢN SIÊU TỐC", 12, 2.2, "#e63946", "#fff", "🎢 Cao 30m · Vòng xoắn 360°");
    sign.position.set(8, 6.2, 6.6);
    g.add(sign);
    this.group.add(g);
    this.boardZone.set(O.x + 8, 0, O.z + 4);
    this.exitPoint.set(O.x + 8, 0, O.z + 5.5);
  }

  private buildTrain(body: string, accent: string) {
    const cars: THREE.Group[] = [];
    const bodyMat = std(body, { metalness: 0.35, roughness: 0.35 });
    const accMat = std(accent, { metalness: 0.2, roughness: 0.4 });
    const dark = std("#22252b");
    const seatMat = std("#2b2d42");
    const chassis = new THREE.BoxGeometry(1.5, 0.3, 2.1);
    const side = new THREE.BoxGeometry(0.1, 0.32, 2.0);
    const back = new THREE.BoxGeometry(1.4, 0.6, 0.12);
    const seatGeo = new THREE.BoxGeometry(0.55, 0.12, 0.6);
    const wheel = new THREE.BoxGeometry(0.14, 0.22, 0.4);
    const bar = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6);
    const nose = new THREE.BoxGeometry(1.4, 0.3, 0.7);
    for (let j = 0; j < CARS; j++) {
      const car = new THREE.Group();
      car.matrixAutoUpdate = false;
      const c = new THREE.Mesh(chassis, bodyMat);
      c.position.y = 0.32;
      car.add(c);
      for (const sx of [-0.72, 0.72]) {
        const s = new THREE.Mesh(side, bodyMat);
        s.position.set(sx, 0.6, 0);
        car.add(s);
        for (const sz of [-0.7, 0.7]) {
          const w = new THREE.Mesh(wheel, dark);
          w.position.set(sx * 0.82, 0.05, sz);
          car.add(w);
        }
      }
      const b = new THREE.Mesh(back, accMat);
      b.position.set(0, 0.8, -0.85);
      car.add(b);
      for (const sx of [-0.36, 0.36]) {
        const st = new THREE.Mesh(seatGeo, seatMat);
        st.position.set(sx, 0.5, -0.3);
        car.add(st);
      }
      const lb = new THREE.Mesh(bar, dark);
      lb.rotation.z = Math.PI / 2;
      lb.position.set(0, 1.0, 0.25);
      car.add(lb);
      if (j === 0) {
        const n = new THREE.Mesh(nose, accMat);
        n.rotation.x = 0.35;
        n.position.set(0, 0.5, 1.25);
        car.add(n);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff6c2" }));
        lamp.position.set(0, 0.55, 1.6);
        car.add(lamp);
      }
      car.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.group.add(car);
      cars.push(car);
    }
    return cars;
  }
}
