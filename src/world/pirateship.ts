import * as THREE from "three";
import { BoxCollider, Collider, canvasTexture, makeSign, std } from "../util";

// Swinging pirate ship. The hull hangs from a pivot and swings like a pendulum in the y-z plane
// (long axis along z); its angle is a pure function of server time, so everyone sees the same swing.
// Cycle: board → swings build up to ±70° → hold → die down → unload.

const PIVOT_Y = 12.4;
const ARM = 10.8; // pivot → deck centre
const HALF_LEN = 8.2; // hull half length (z)
const HALF_W = 2.5; // hull half width (x)
const ROWS = [-5.4, -2.2, 2.2, 5.4]; // bench z, relative to the hull centre
const ACROSS = [-1.65, -0.55, 0.55, 1.65]; // seat x on each bench
export const SHIP_SEATS = ROWS.length * ACROSS.length;

const BOARD = 15;
const SWING_T = 6.6; // seconds per full swing
const BUILD = SWING_T * 3; // amplitude rises over three swings
const HOLD = SWING_T * 2;
const FADE = SWING_T * 3;
const RUN = BUILD + HOLD + FADE;
const UNLOAD = 3;
const PERIOD = Math.ceil(BOARD + RUN + UNLOAD);
const A_MAX = (70 * Math.PI) / 180;

/** Deck height above the pivot at hull-relative z: the deck curves up toward bow and stern. */
const deckY = (z: number) => -ARM + 0.045 * z * z;
const topY = (z: number) => -ARM + 1.5 + 0.07 * z * z;
const botY = (z: number) => -ARM - 1.0 + 0.05 * z * z;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export type ShipPhase = "board" | "swing" | "done";

export class PirateShip {
  group = new THREE.Group();
  colliders: Collider[] = [];
  boxes: BoxCollider[] = [];
  center: THREE.Vector3;
  boardZone: THREE.Vector3;
  exitPoint: THREE.Vector3;
  seats = SHIP_SEATS;
  readonly maxAngle = A_MAX;
  private boat = new THREE.Group();
  private bulbs!: THREE.InstancedMesh;
  private bulbCols: THREE.Color[] = [];

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    // boarding from the east side (+x), next to the middle of the hull
    this.boardZone = new THREE.Vector3(x + 8.5, 0, z);
    this.exitPoint = new THREE.Vector3(x + 9.5, 0, z + 2.5);
    // the swept area under the hull is fenced off
    this.boxes.push({ minX: x - 4.2, maxX: x + 4.2, minZ: z - 15.5, maxZ: z + 15.5 });
    this.build();
  }

  cycleOf(now: number) {
    const Pms = PERIOD * 1000;
    const c = Math.floor(now / Pms);
    return { cycle: c, cycleStart: c * Pms, key: `ship:${c}` };
  }

  /** Swing angle (rad, + tips the bow (+z) up) `t` seconds into a cycle. */
  angle(t: number) {
    const s = t - BOARD;
    if (s <= 0 || s >= RUN) return 0;
    const amp = A_MAX * (s < BUILD ? smooth(s / BUILD) : s < BUILD + HOLD ? 1 : 1 - smooth((s - BUILD - HOLD) / FADE));
    return amp * Math.sin((s / SWING_T) * Math.PI * 2);
  }

  phase(t: number): ShipPhase {
    return t < BOARD ? "board" : t < BOARD + RUN + UNLOAD ? "swing" : "done";
  }

  /** Current cycle if it's still boarding with ≥ minLeft seconds to go. */
  boardable(now: number, minLeft = 1.5) {
    const c = this.cycleOf(now);
    const t = (now - c.cycleStart) / 1000;
    return t < BOARD - minLeft ? { ...c, waiting: BOARD - t } : null;
  }
  nextBoarding(now: number) {
    const c = this.cycleOf(now);
    return (c.cycleStart + PERIOD * 1000 - now) / 1000;
  }

  seatPose(key: string, seat: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const m = /^ship:(-?\d+)$/.exec(key);
    if (!m) return { ok: false, done: true };
    const t = (now - +m[1] * PERIOD * 1000) / 1000;
    const ph = this.phase(t);
    const a = this.angle(t);
    const h = 0.02;
    const w = (this.angle(t + h) - this.angle(t - h)) / (2 * h);
    const s = seat % SHIP_SEATS;
    const rz = ROWS[Math.floor(s / ACROSS.length)], rx = ACROSS[s % ACROSS.length];
    tmp.set(rx, deckY(rz) + 0.62, rz).applyAxisAngle(X, -a);
    pos.set(this.center.x + tmp.x, PIVOT_Y + tmp.y, this.center.z + tmp.z);
    // benches face the middle of the ship
    quat.setFromAxisAngle(X, -a).multiply(qy.setFromAxisAngle(Y, rz > 0 ? Math.PI : 0));
    const r = Math.hypot(rz, deckY(rz));
    return {
      ok: true,
      done: ph === "done",
      speed: Math.abs(w) * r,
      g: Math.max(0, Math.cos(a) + (w * w * r) / 9.81),
      waiting: Math.max(0, BOARD - t),
      height: PIVOT_Y + tmp.y,
      phase: ph,
      angle: a,
    };
  }

  update(now: number) {
    const c = this.cycleOf(now);
    const t = (now - c.cycleStart) / 1000;
    const a = this.angle(t);
    this.boat.rotation.x = -a;
    // lights chase along the hull while swinging, steady while boarding
    const sec = now / 1000;
    const n = this.bulbCols.length;
    const swinging = this.phase(t) === "swing";
    for (let i = 0; i < n; i++) {
      const on = !swinging || (i + Math.floor(sec * 8)) % 4 < 2;
      tmpC.copy(this.bulbCols[i]).multiplyScalar(on ? 1 : 0.2);
      this.bulbs.setColorAt(i, tmpC);
    }
    this.bulbs.instanceColor!.needsUpdate = true;
  }

  private build() {
    const wood = std("#8b4a2b", { roughness: 0.8 });
    const woodDark = std("#5c2e1a", { roughness: 0.85 });
    const trim = std("#ffd166", { metalness: 0.5, roughness: 0.4 });
    const frame = std("#2b2d42", { metalness: 0.6, roughness: 0.4 });

    // ---- A-frames on both sides of the hull ----
    const legGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 10);
    legGeo.translate(0, 0.5, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const base = new THREE.Vector3(sx * 4.6, 0, sz * 6.5);
      const top = new THREE.Vector3(sx * 3.4, PIVOT_Y, 0);
      const leg = new THREE.Mesh(legGeo, frame);
      leg.position.copy(base);
      const dir = top.clone().sub(base);
      leg.scale.set(1, dir.length(), 1);
      leg.quaternion.setFromUnitVectors(Y, dir.normalize());
      leg.castShadow = true;
      this.group.add(leg);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 7.6, 14), frame);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = PIVOT_Y;
    axle.castShadow = true;
    this.group.add(axle);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 10), trim);
      cap.position.set(sx * 3.9, PIVOT_Y, 0);
      this.group.add(cap);
    }
    // a flag on top
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), frame);
    pole.position.y = PIVOT_Y + 2.2;
    const flagTex = canvasTexture(64, 40, (g) => {
      g.fillStyle = "#1b2340";
      g.fillRect(0, 0, 64, 40);
      g.strokeStyle = g.fillStyle = "#fff";
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(18, 30); g.lineTo(46, 10); g.moveTo(18, 10); g.lineTo(46, 30); g.stroke();
      g.beginPath(); g.arc(32, 17, 8, 0, 7); g.fill();
      g.fillStyle = "#1b2340";
      g.fillRect(27, 15, 3, 3); g.fillRect(34, 15, 3, 3);
    });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(0, PIVOT_Y + 3.2, 0.82);
    this.group.add(pole, flag);

    // ---- the boat (rotates about the pivot) ----
    this.boat.position.y = PIVOT_Y;
    this.group.add(this.boat);
    // hull sides: profile in (z, y), extruded thin, one on each side
    const prof = new THREE.Shape();
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const z = -HALF_LEN + (2 * HALF_LEN * i) / N;
      if (i === 0) prof.moveTo(z, topY(z));
      else prof.lineTo(z, topY(z));
    }
    for (let i = N; i >= 0; i--) {
      const z = -HALF_LEN + (2 * HALF_LEN * i) / N;
      prof.lineTo(z * 0.96, botY(z));
    }
    const sideGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.18, bevelEnabled: false });
    // shape x → world z, shape y → world y, extrude (+z) → world x
    sideGeo.rotateY(-Math.PI / 2);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(sideGeo, wood);
      side.position.x = sx * HALF_W + (sx > 0 ? 0.18 : 0);
      this.boat.add(side);
    }
    // stripe of gold trim along each gunwale, and portholes
    for (const sx of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const z0 = -HALF_LEN + (2 * HALF_LEN * i) / N, z1 = z0 + (2 * HALF_LEN) / N;
        const y0 = topY(z0), y1 = topY(z1);
        const len = Math.hypot(z1 - z0, y1 - y0);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, len + 0.02), trim);
        seg.position.set(sx * (HALF_W + 0.1), (y0 + y1) / 2, (z0 + z1) / 2);
        seg.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
        this.boat.add(seg);
      }
      for (const z of [-4.5, -1.5, 1.5, 4.5]) {
        const ph = new THREE.Mesh(new THREE.CircleGeometry(0.32, 14), std("#1b2340"));
        ph.position.set(sx * (HALF_W + 0.2), (topY(z) + botY(z)) / 2 - 0.1, z);
        ph.rotation.y = (sx * Math.PI) / 2;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 16), trim);
        ring.position.copy(ph.position);
        ring.rotation.y = ph.rotation.y;
        this.boat.add(ph, ring);
      }
    }
    // keel: a curved row of boxes along the bottom
    for (let i = 0; i < N; i++) {
      const z0 = -HALF_LEN * 0.96 + (2 * HALF_LEN * 0.96 * i) / N, z1 = z0 + (2 * HALF_LEN * 0.96) / N;
      const y0 = botY(z0 / 0.96), y1 = botY(z1 / 0.96);
      const len = Math.hypot(z1 - z0, y1 - y0);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W + 0.36, 0.2, len + 0.04), woodDark);
      seg.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
      seg.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
      this.boat.add(seg);
    }
    // stepped decks and benches
    const benchCols = ["#e63946", "#ffd166", "#2ec4b6", "#3a86ff"];
    for (let r = 0; r < ROWS.length; r++) {
      const z = ROWS[r];
      const face = z > 0 ? -1 : 1; // riders face the middle
      const floor = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W, 0.16, 3.0), woodDark);
      floor.position.set(0, deckY(z) - 0.08 - 0.05, z);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W, 0.14, 0.6), std(benchCols[r]));
      bench.position.set(0, deckY(z) + 0.48, z - face * 0.05);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W, 0.9, 0.12), std(benchCols[r]));
      back.position.set(0, deckY(z) + 0.95, z - face * 0.42);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2 * HALF_W, 6), trim);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, deckY(z) + 0.85, z + face * 0.5);
      this.boat.add(floor, bench, back, bar);
    }
    const mid = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_W, 0.16, 1.6), woodDark);
    mid.position.set(0, deckY(0) - 0.13, 0);
    this.boat.add(mid);
    // bow & stern: close the hull ends, then a stem post on each with a dragon head at the bow
    const zEndTop = HALF_LEN, zEndBot = HALF_LEN * 0.96;
    const yEndTop = topY(HALF_LEN), yEndBot = botY(HALF_LEN);
    const endH = Math.hypot(yEndTop - yEndBot, zEndTop - zEndBot);
    const endGeo = new THREE.BoxGeometry(2 * HALF_W + 0.36, endH, 0.22);
    const POST_LEN = 3.2, POST_TILT = 0.35;
    const postGeo = new THREE.CylinderGeometry(0.2, 0.3, POST_LEN, 8);
    for (const sz of [-1, 1]) {
      const end = new THREE.Mesh(endGeo, wood);
      end.position.set(0, (yEndTop + yEndBot) / 2, (sz * (zEndTop + zEndBot)) / 2 - sz * 0.11);
      end.rotation.x = sz * Math.atan2(zEndTop - zEndBot, yEndTop - yEndBot);
      this.boat.add(end);
      // stem post: its foot sits inside the hull end, its top leans outward
      const foot = new THREE.Vector3(0, yEndTop - 0.6, sz * (HALF_LEN - 0.25));
      const dir = new THREE.Vector3(0, Math.cos(POST_TILT), sz * Math.sin(POST_TILT));
      const post = new THREE.Mesh(postGeo, woodDark);
      post.position.copy(foot).addScaledVector(dir, POST_LEN / 2);
      post.quaternion.setFromUnitVectors(Y, dir);
      this.boat.add(post);
      const top = foot.clone().addScaledVector(dir, POST_LEN);
      if (sz > 0) {
        const green = std("#2a9d55");
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), green);
        skull.position.copy(top);
        const snout = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 8), green);
        snout.rotation.x = Math.PI / 2; // points +z (forward)
        snout.position.copy(top).add(new THREE.Vector3(0, -0.05, 0.6));
        const hornGeo = new THREE.ConeGeometry(0.09, 0.4, 6);
        this.boat.add(skull, snout);
        for (const ex of [-0.22, 0.22]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), std("#ffd166"));
          eye.position.copy(top).add(new THREE.Vector3(ex, 0.14, 0.32));
          const horn = new THREE.Mesh(hornGeo, std("#ffd166"));
          horn.position.copy(top).add(new THREE.Vector3(ex, 0.45, -0.12));
          horn.rotation.x = -0.4;
          this.boat.add(eye, horn);
        }
      } else {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), trim);
        lantern.position.copy(top);
        this.boat.add(lantern);
      }
    }
    // arms from the pivot down to the hull
    const armGeo = new THREE.BoxGeometry(0.35, 1, 0.35);
    armGeo.translate(0, -0.5, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const end = new THREE.Vector3(sx * (HALF_W + 0.25), topY(sz * 4.2), sz * 4.2);
      const arm = new THREE.Mesh(armGeo, frame);
      arm.position.set(sx * (HALF_W + 0.25), 0, 0);
      const d = end.clone().sub(arm.position);
      arm.scale.y = d.length();
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
      this.boat.add(arm);
    }
    // name board on both sides
    for (const sx of [-1, 1]) {
      const s = makeSign("HẢI TẶC", 3.6, 0.8, "#1b2340", "#ffd166");
      s.position.set(sx * (HALF_W + 0.24), botY(0) + 0.75, 0);
      s.rotation.y = (sx * Math.PI) / 2;
      (s.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
      this.boat.add(s);
    }
    // bulbs along the gunwales
    const nb = 30;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), new THREE.MeshBasicMaterial({ color: "#fff" }), nb * 2);
    const palette = ["#ffd166", "#ff4e7a", "#ffffff"];
    const m = new THREE.Matrix4();
    let k = 0;
    for (const sx of [-1, 1]) for (let i = 0; i < nb; i++) {
      const z = -HALF_LEN + 0.4 + ((2 * HALF_LEN - 0.8) * i) / (nb - 1);
      m.makeTranslation(sx * (HALF_W + 0.28), topY(z) - 0.25, z);
      this.bulbs.setMatrixAt(k, m);
      const c = new THREE.Color(palette[i % palette.length]);
      this.bulbCols.push(c);
      this.bulbs.setColorAt(k++, c);
    }
    this.boat.add(this.bulbs);
    this.boat.traverse((o) => ((o as THREE.Mesh).isMesh && o !== this.bulbs && (o.castShadow = true)));

    // ---- ground: sand pit under the hull, fence, boarding deck ----
    const pit = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.08, 31), std("#d9c49b", { roughness: 1 }));
    pit.position.y = 0.04;
    pit.receiveShadow = true;
    this.group.add(pit);
    const railMat = std("#ffffff");
    const fpost = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6);
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i <= n; i++) {
        const p = new THREE.Mesh(fpost, railMat);
        p.position.set(x0 + ((x1 - x0) * i) / n, 0.55, z0 + ((z1 - z0) * i) / n);
        this.group.add(p);
      }
      for (const y of [0.55, 1.05]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), railMat);
        r.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
        r.rotation.y = Math.atan2(x1 - x0, z1 - z0);
        this.group.add(r);
      }
    };
    rail(-4.2, -15.5, 4.2, -15.5);
    rail(-4.2, 15.5, 4.2, 15.5);
    rail(-4.2, -15.5, -4.2, 15.5);
    rail(4.2, -15.5, 4.2, -2.2);
    rail(4.2, 2.2, 4.2, 15.5);
    const dock = new THREE.Mesh(new THREE.BoxGeometry(6, 0.22, 5.5), std("#c9b79c"));
    dock.position.set(7.2, 0.06, 0);
    dock.receiveShadow = true;
    this.group.add(dock);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.colliders.push({ x: this.center.x + sx * 4.6, z: this.center.z + sz * 6.5, r: 0.6 });
  }
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const qy = new THREE.Quaternion();
const tmpC = new THREE.Color();
