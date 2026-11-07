import * as THREE from "three";
import { Collider, rng, std } from "../util";

// The plaza fountain. Every SHOW_EVERY seconds of shared server time it puts on a water show (taller
// jets chasing round the ring, colour-shifting water), so everyone sees the same show with no state.
// Wishes (convex/fountain.ts): a coin flies from the wisher's hand into the basin, splashes, and the
// centre jet bursts. Every coin ever wished stays in the basin (up to MAX_COINS shown).

/** What the fountain tells you after a wish ({star} is prepended). */
export const WISHES = [
  "Đồng xu chìm xuống… điều ước sẽ thành sự thật!",
  "Thần đài phun nước gật gù: điều ước này hay đấy!",
  "Hôm nay bạn sẽ gặp nhiều may mắn!",
  "Sắp có người bạn mới rủ bạn đi tàu lượn đấy.",
  "Điều ước đã gửi đi. Chúc bạn một ngày thật vui!",
  "Ước gì được nấy – nhưng nhớ ăn thêm cây kem nhé!",
  "Thần nước thì thầm: lần sau thử Tháp Rơi Tự Do xem.",
  "Một điều tốt lành đang đến gần…",
  "Lời chúc: học giỏi, làm ăn phát đạt, ăn kem không lo béo!",
  "Thần đài phun nước đã nghe thấy. Giờ thì đi chơi tiếp thôi!",
];

export const SHOW_EVERY = 90;
export const SHOW_LEN = 16;
const WATER_Y = 0.55;
const MAX_COINS = 90;
const MAX_DROPS = 420;
const G = 9.8;

type Drop = { p: THREE.Vector3; v: THREE.Vector3; alive: boolean };
type Flight = { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; onLand?: () => void };
type Ring = { mesh: THREE.Mesh; t0: number };

export class Fountain {
  group = new THREE.Group();
  colliders: Collider[] = [{ x: 0, z: 0, r: 6.5 }];
  readonly center = new THREE.Vector3(0, 0, 0);
  /** Stand within this of the centre (outside the flower bed) to make a wish. */
  readonly reach = 11;

  private water: THREE.Mesh;
  private jetMat: THREE.MeshStandardMaterial;
  private spout: THREE.Mesh;
  private umbrella: THREE.Mesh;
  private jets: THREE.Mesh[] = [];
  private bursts: number[] = [];
  private drops: Drop[] = [];
  private dropMesh: THREE.InstancedMesh;
  private flights: Flight[] = [];
  private rings: Ring[] = [];
  private ringPool: THREE.Mesh[] = [];
  private coins: THREE.InstancedMesh;
  private coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 12);
  private coinMat = new THREE.MeshStandardMaterial({ color: "#ffd166", metalness: 0.7, roughness: 0.3, emissive: "#c98a00", emissiveIntensity: 0.45 });
  private shown = 0;
  private spray = 0;
  private lastT = 0;

  constructor() {
    const g = this.group;
    const stone = std("#d6d0c4");
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.3, 0.7, 40, 1, true), stone);
    basin.position.y = 0.35;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(6.05, 0.22, 8, 48), stone);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.7;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 40), std("#7fb8c9"));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.06;
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(5.9, 40),
      new THREE.MeshStandardMaterial({ color: "#4cc9f0", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.72, depthWrite: false }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 2.2, 16), stone);
    tier1.position.y = 1.1;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.0, 0.5, 24), stone);
    bowl.position.y = 2.3;
    const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.4, 12), stone);
    tier2.position.y = 3.2;
    const bowl2 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.35, 20), stone);
    bowl2.position.y = 3.9;
    for (const m of [basin, rim, tier1, bowl, tier2, bowl2]) { m.castShadow = m.receiveShadow = true; }
    g.add(basin, rim, floor, this.water, tier1, bowl, tier2, bowl2);

    this.jetMat = new THREE.MeshStandardMaterial({ color: "#bde9ff", emissive: "#7fd0ff", emissiveIntensity: 0.25, transparent: true, opacity: 0.6, roughness: 0.1, depthWrite: false });
    // water geometry grows upward from its base, so scale.y is "jet height"
    const ringGeo = new THREE.CylinderGeometry(0.05, 0.12, 2.2, 6, 1, true).translate(0, 1.1, 0);
    for (let i = 0; i < 8; i++) {
      const j = new THREE.Mesh(ringGeo, this.jetMat);
      const a = (i / 8) * Math.PI * 2;
      j.position.set(Math.cos(a) * 4.7, WATER_Y - 0.1, Math.sin(a) * 4.7);
      // lean in toward the centre
      j.rotation.set(-Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
      this.jets.push(j);
      g.add(j);
    }
    this.spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.25, 3, 8, 1, true).translate(0, 1.5, 0), this.jetMat);
    this.spout.position.y = 4.0;
    // a tulip of water opening upward from the top bowl
    this.umbrella = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3, 12, 1, true).rotateX(Math.PI).translate(0, 1.5, 0), this.jetMat);
    this.umbrella.position.y = 4.0;
    g.add(this.spout, this.umbrella);

    this.dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 5, 3), this.jetMat, MAX_DROPS);
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    g.add(this.dropMesh);
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), alive: false });

    const ringMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 20), ringMat.clone());
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      this.ringPool.push(r);
      g.add(r);
    }

    this.coins = new THREE.InstancedMesh(this.coinGeo, this.coinMat, MAX_COINS);
    this.coins.count = 0;
    const cr = rng(2024);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < MAX_COINS; i++) {
      const a = cr() * Math.PI * 2, r = 1.2 + Math.sqrt(cr()) * 4.4;
      e.set((cr() - 0.5) * 0.3, cr() * 6, (cr() - 0.5) * 0.3);
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0.09, Math.sin(a) * r), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
      this.coins.setMatrixAt(i, m);
    }
    g.add(this.coins);
  }

  /** How far into a water show the shared clock is (0…1), or -1 between shows. */
  showPhase(now: number) {
    const s = (now / 1000) % SHOW_EVERY;
    return s < SHOW_LEN ? s / SHOW_LEN : -1;
  }
  /** Seconds until the next show starts (0 while one is on). */
  nextShow(now: number) {
    const s = (now / 1000) % SHOW_EVERY;
    return s < SHOW_LEN ? 0 : SHOW_EVERY - s;
  }

  /** Coins lying in the basin. */
  setCoins(n: number) {
    this.shown = Math.max(0, Math.min(MAX_COINS, n));
    this.coins.count = this.shown;
  }
  get coinCount() {
    return this.shown;
  }

  /** The centre jet shoots up and showers the basin. */
  burst(t: number) {
    this.bursts.push(t);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.6;
      this.spawnDrop(0, 7.5 + Math.random(), 0, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s);
    }
  }

  /** A coin flies from a hand (world position) into the water; splash + `onLand` when it lands. */
  toss(from: THREE.Vector3, t: number, onLand?: () => void) {
    const a = Math.atan2(from.z, from.x) + (Math.random() - 0.5) * 0.9;
    const r = 2.6 + Math.random() * 2.4;
    const to = new THREE.Vector3(Math.cos(a) * r, WATER_Y, Math.sin(a) * r);
    const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
    mesh.scale.setScalar(1.4);
    mesh.position.copy(from);
    this.group.add(mesh);
    this.flights.push({ mesh, from: from.clone(), to, t0: t, dur: 0.95, onLand });
  }

  private spawnDrop(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    const d = this.drops.find((d) => !d.alive);
    if (!d) return;
    d.alive = true;
    d.p.set(x, y, z);
    d.v.set(vx, vy, vz);
  }

  private splash(at: THREE.Vector3, t: number) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 0.9;
      this.spawnDrop(at.x, WATER_Y + 0.05, at.z, Math.cos(a) * s, 1.8 + Math.random() * 2, Math.sin(a) * s);
    }
    const mesh = this.ringPool.find((r) => !r.visible) ?? this.rings.shift()?.mesh;
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(at.x, WATER_Y + 0.03, at.z);
    this.rings.push({ mesh, t0: t });
  }

  /** `now`: shared server time (water show). `t`: local seconds (effects). */
  update(now: number, t: number) {
    const dt = Math.min(0.05, Math.max(0, t - this.lastT));
    this.lastT = t;
    const ph = this.showPhase(now);
    // show intensity: ease in over the first 12%, out over the last 12%
    const k = ph < 0 ? 0 : Math.min(1, ph / 0.12, (1 - ph) / 0.12);
    const st = now / 1000;
    this.bursts = this.bursts.filter((b) => t - b < 3);
    const burst = this.bursts.reduce((m, b) => Math.max(m, Math.sin(Math.min(1, (t - b) / 2.6) * Math.PI)), 0);

    const spoutH = 1 + Math.sin(t * 3) * 0.12 + k * (1.6 + Math.sin(st * 2.2) * 0.5) + burst * 2.6;
    const wide = 1 + k * 0.7 + burst * 0.6;
    this.spout.scale.set(wide, spoutH, wide);
    this.umbrella.scale.set(1 + k * 0.6 + burst, 1 + k * 0.5 + burst * 0.8, 1 + k * 0.6 + burst);
    this.umbrella.rotation.y = t;
    this.jets.forEach((j, i) => {
      const chase = 0.5 + 0.5 * Math.sin(st * 4.5 - (i * Math.PI) / 4);
      j.scale.y = 1 + Math.sin(t * 4 + i) * 0.15 + k * (0.3 + chase * 1.6) + burst * 0.6;
    });
    this.water.position.y = WATER_Y + Math.sin(t * 2) * 0.02;
    // colour-shifting water during the show
    if (k > 0) this.jetMat.color.setHSL((st * 0.08) % 1, 0.75, 0.82 - 0.1 * k);
    else this.jetMat.color.set("#bde9ff");
    this.jetMat.opacity = 0.6 + k * 0.15;

    // spray off the top jet and the ring jets while the show runs
    this.spray += k * dt * 260;
    for (; this.spray >= 1; this.spray--) {
      const a = Math.random() * Math.PI * 2;
      if (Math.random() < 0.6) {
        const s = 0.6 + Math.random() * 2.2;
        this.spawnDrop(0, 3.6 + 3 * spoutH, 0, Math.cos(a) * s, 0.5 + Math.random() * 2.5, Math.sin(a) * s);
      } else {
        const j = this.jets[Math.floor(Math.random() * this.jets.length)];
        tip.set(0, 2.2 * j.scale.y, 0).applyEuler(j.rotation).add(j.position);
        const s = 0.6 + Math.random() * 0.8, out = Math.atan2(j.position.z, j.position.x) + Math.PI;
        this.spawnDrop(tip.x, tip.y, tip.z, Math.cos(out) * s + Math.cos(a) * 0.3, Math.random() * 1.5, Math.sin(out) * s + Math.sin(a) * 0.3);
      }
    }

    // coins in flight
    this.flights = this.flights.filter((f) => {
      const u = (t - f.t0) / f.dur;
      if (u >= 1) {
        f.mesh.removeFromParent();
        this.splash(f.to, t);
        f.onLand?.();
        return false;
      }
      f.mesh.position.lerpVectors(f.from, f.to, u);
      f.mesh.position.y += Math.sin(u * Math.PI) * 2.2;
      f.mesh.rotation.x = u * 18;
      return true;
    });

    // droplets
    let n = 0;
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.v.y -= G * dt;
      d.p.addScaledVector(d.v, dt);
      const inBasin = d.p.x * d.p.x + d.p.z * d.p.z < 36;
      if (d.p.y < (inBasin ? WATER_Y : 0.05)) { d.alive = false; continue; }
      mat.makeTranslation(d.p.x, d.p.y, d.p.z);
      this.dropMesh.setMatrixAt(n++, mat);
    }
    this.dropMesh.count = n;
    if (n) this.dropMesh.instanceMatrix.needsUpdate = true;

    // splash rings
    this.rings = this.rings.filter((r) => {
      const u = (t - r.t0) / 0.9;
      if (u >= 1) { r.mesh.visible = false; return false; }
      r.mesh.scale.setScalar(1 + u * 7);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - u);
      return true;
    });
  }
}

const mat = new THREE.Matrix4();
const tip = new THREE.Vector3();
