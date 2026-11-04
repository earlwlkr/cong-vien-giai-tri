import * as THREE from "three";
import { BoxCollider, Collider, canvasTexture, makeSign, std } from "../util";

// Bumper car arena. Each rider drives their own car locally and streams its position like walking;
// every client resolves its own car's bumps against the others (so both cars bounce).

export const N_CARS = 8;
const HX = 14, HZ = 10; // floor half-size
const R_CAR = 0.95;
const ROOF_Y = 4.8;
const MAX_FWD = 7, MAX_REV = 3.2, ACCEL = 7, COAST = 1.4, GRIP = 3.5, STEER = 2.4;
const WALL_E = 0.55, CAR_E = 0.8;
const COLORS = ["#ff4e7a", "#ffd166", "#2ec4b6", "#3a86ff", "#8338ec", "#06d6a0", "#ff9f1c", "#e63946"];
const UP = new THREE.Vector3(0, 1, 0);
const SEAT = new THREE.Vector3(0, 0.6, -0.22); // hip, car-local

export interface CarState {
  x: number;
  z: number;
  yaw: number;
}
export interface OtherCar {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Parked cars don't move when hit. */
  fixed?: boolean;
  /**
   * Remote cars are seen ~0.2 s late, and the driver who rams us bounces off on their own screen
   * before their streamed position overlaps ours. When they're the one closing in, count contact
   * this much earlier so the hit still lands on our side.
   */
  margin?: number;
  id?: string;
}

export class BumperCars {
  group = new THREE.Group();
  colliders: Collider[] = [];
  boxes: BoxCollider[] = [];
  center: THREE.Vector3;
  boardZone: THREE.Vector3;
  exitPoint: THREE.Vector3;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The car this client is driving (null when not driving). */
  drive: (CarState & { i: number; vx: number; vz: number }) | null = null;
  private cars: { g: THREE.Group; spark: THREE.Sprite }[] = [];

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    this.bounds = { minX: x - HX, maxX: x + HX, minZ: z - HZ, maxZ: z + HZ };
    // entrance booth on the west side
    this.boardZone = new THREE.Vector3(x - HX - 2.6, 0, z);
    this.exitPoint = new THREE.Vector3(x - HX - 3.2, 0, z + 2.2);
    this.boxes.push({ minX: x - HX - 0.5, maxX: x + HX + 0.5, minZ: z - HZ - 0.5, maxZ: z + HZ + 0.5 });
    this.build();
  }

  parked(i: number): CarState {
    return { x: this.center.x + (i - (N_CARS - 1) / 2) * 3.3, z: this.center.z - HZ + 1.7, yaw: 0 };
  }

  /** Free car nearest the entrance. */
  freeCar(taken: Set<number>) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N_CARS; i++) {
      if (taken.has(i)) continue;
      const p = this.parked(i);
      const d = Math.hypot(p.x - this.boardZone.x, p.z - this.boardZone.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  startDriving(i: number) {
    const p = this.parked(i);
    this.drive = { i, ...p, vx: 0, vz: 0 };
  }
  stopDriving() {
    this.drive = null;
  }

  speed() {
    const d = this.drive;
    return d ? Math.hypot(d.vx, d.vz) : 0;
  }

  /**
   * Advances the local car. `throttle`/`steer` in [-1, 1] (steer > 0 = right).
   * Returns the hardest impact speed this step (0 = no bump) and the car it hit, if any.
   */
  step(dt: number, throttle: number, steer: number, others: OtherCar[]) {
    const d = this.drive;
    if (!d) return { impact: 0, car: false };
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);
    let fwd = d.vx * fx + d.vz * fz;
    let lx = d.vx - fx * fwd, lz = d.vz - fz * fwd;
    // steering: spins a little even when stopped, reverses when backing up
    const turn = 0.35 + 0.65 * Math.min(1, Math.abs(fwd) / 3);
    d.yaw -= steer * STEER * turn * (fwd < -0.3 ? -1 : 1) * dt;
    if (throttle) fwd += throttle * ACCEL * dt;
    else fwd *= Math.exp(-COAST * dt);
    fwd = Math.max(-MAX_REV, Math.min(MAX_FWD, fwd));
    const grip = Math.exp(-GRIP * dt);
    lx *= grip;
    lz *= grip;
    const nfx = Math.sin(d.yaw), nfz = Math.cos(d.yaw);
    d.vx = nfx * fwd + lx;
    d.vz = nfz * fwd + lz;
    d.x += d.vx * dt;
    d.z += d.vz * dt;

    let impact = 0, car = false, hit: OtherCar | null = null;
    const b = this.bounds;
    if (d.x < b.minX + R_CAR) { d.x = b.minX + R_CAR; if (d.vx < 0) { impact = Math.max(impact, -d.vx); d.vx = -d.vx * WALL_E; } }
    if (d.x > b.maxX - R_CAR) { d.x = b.maxX - R_CAR; if (d.vx > 0) { impact = Math.max(impact, d.vx); d.vx = -d.vx * WALL_E; } }
    if (d.z < b.minZ + R_CAR) { d.z = b.minZ + R_CAR; if (d.vz < 0) { impact = Math.max(impact, -d.vz); d.vz = -d.vz * WALL_E; } }
    if (d.z > b.maxZ - R_CAR) { d.z = b.maxZ - R_CAR; if (d.vz > 0) { impact = Math.max(impact, d.vz); d.vz = -d.vz * WALL_E; } }
    for (const o of others) {
      let nx = d.x - o.x, nz = d.z - o.z;
      const dist = Math.hypot(nx, nz);
      if (dist >= R_CAR * 2 + (o.margin ?? 0) || dist < 1e-4) continue;
      nx /= dist;
      nz /= dist;
      const theirs = o.vx * nx + o.vz * nz; // > 0: they're closing in on us
      const mine = -(d.vx * nx + d.vz * nz);
      if (dist >= R_CAR * 2 && theirs <= mine) continue; // margin only counts when they're the rammer
      if (dist < R_CAR * 2) {
        d.x += nx * (R_CAR * 2 - dist);
        d.z += nz * (R_CAR * 2 - dist);
      }
      const vn = (d.vx - o.vx) * nx + (d.vz - o.vz) * nz;
      if (vn < 0) {
        // equal masses: each client applies its half of the exchange; parked cars act like walls
        const k = (1 + CAR_E) * (o.fixed ? 1 : 0.5);
        d.vx -= k * vn * nx;
        d.vz -= k * vn * nz;
        if (-vn > impact) { impact = -vn; car = true; hit = o; }
      }
    }
    return { impact, car, hit };
  }

  /** Rider hip pose for a car at (x, z, yaw). */
  seatPose(c: CarState, pos: THREE.Vector3, quat: THREE.Quaternion) {
    quat.setFromAxisAngle(UP, c.yaw);
    pos.copy(SEAT).applyQuaternion(quat);
    pos.x += c.x;
    pos.z += c.z;
  }

  /** Places every car: claimed ones where their drivers are, the rest parked. */
  update(t: number, claims: Map<number, CarState & { speed: number }>) {
    for (let i = 0; i < N_CARS; i++) {
      const c = claims.get(i);
      const s = c ?? this.parked(i);
      const car = this.cars[i];
      car.g.position.set(s.x - this.center.x, 0, s.z - this.center.z);
      car.g.rotation.y = s.yaw;
      // sparks where the pole touches the ceiling grid
      const moving = (c?.speed ?? 0) > 0.6;
      const flick = moving && Math.sin(t * 53 + i * 7.1) > 0.35;
      car.spark.visible = flick;
      if (flick) car.spark.scale.setScalar(0.35 + Math.random() * 0.35);
    }
  }

  private build() {
    // floor: steel plates
    const floorTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = "#6c7686";
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = "#596273";
      g.lineWidth = 3;
      g.strokeRect(0, 0, 128, 128);
      g.fillStyle = "#7b8597";
      for (let y = 8; y < 128; y += 16) for (let x = 8 + ((y / 16) % 2) * 8; x < 128; x += 16) {
        g.save();
        g.translate(x, y);
        g.rotate(Math.PI / 4);
        g.fillRect(-4, -1.2, 8, 2.4);
        g.restore();
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(HX, HZ);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 1, 0.12, HZ * 2 + 1), new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.35, roughness: 0.6 }));
    floor.position.y = 0.06;
    floor.receiveShadow = true;
    this.group.add(floor);

    // padded walls
    const padMat = std("#ff9f1c", { roughness: 0.9 });
    const capMat = std("#ffffff");
    const wall = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.75, d), padMat);
      m.position.set(x, 0.42, z);
      const c = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.1, d + 0.05), capMat);
      c.position.set(x, 0.83, z);
      m.castShadow = true;
      this.group.add(m, c);
    };
    wall(HX * 2 + 1, 0.5, 0, -HZ - 0.25);
    wall(HX * 2 + 1, 0.5, 0, HZ + 0.25);
    wall(0.5, HZ * 2, -HX - 0.25, 0);
    wall(0.5, HZ * 2, HX + 0.25, 0);

    // canopy on posts, with the classic ceiling grid the poles ride on
    const postMat = std("#3a0ca3", { metalness: 0.4, roughness: 0.4 });
    const postGeo = new THREE.CylinderGeometry(0.22, 0.26, ROOF_Y + 0.4, 12);
    for (const px of [-HX - 0.6, 0, HX + 0.6]) for (const pz of [-HZ - 0.6, HZ + 0.6]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(px, (ROOF_Y + 0.4) / 2, pz);
      p.castShadow = true;
      this.group.add(p);
    }
    const gridMat = new THREE.MeshBasicMaterial({ color: "#2b2d42" });
    for (let x = -HX; x <= HX + 0.01; x += 2) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, HZ * 2), gridMat);
      bar.position.set(x, ROOF_Y - 0.05, 0);
      this.group.add(bar);
    }
    for (let z = -HZ; z <= HZ + 0.01; z += 2) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.05, 0.05), gridMat);
      bar.position.set(0, ROOF_Y - 0.05, z);
      this.group.add(bar);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 2.4, 0.35, HZ * 2 + 2.4), std("#ffffff"));
    roof.position.y = ROOF_Y + 0.35;
    // lit ceiling panels so the underside doesn't pick up the grass tint
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 2.4, HZ * 2 + 2.4), new THREE.MeshStandardMaterial({ color: "#fff3d6", emissive: "#fff0c8", emissiveIntensity: 0.45, roughness: 0.9 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOF_Y + 0.16;
    this.group.add(roof, ceiling);
    // striped fascia around the roof edge
    const stripeTex = canvasTexture(64, 16, (g) => {
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i % 2 ? "#ffffff" : "#e63946";
        g.fillRect(i * 16, 0, 16, 16);
      }
    });
    stripeTex.wrapS = THREE.RepeatWrapping;
    const fascia = (len: number, x: number, z: number, ry: number) => {
      const t = stripeTex.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 2, 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.8, 0.12), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
      m.position.set(x, ROOF_Y + 0.15, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    fascia(HX * 2 + 2.6, 0, -HZ - 1.25, 0);
    fascia(HX * 2 + 2.6, 0, HZ + 1.25, 0);
    fascia(HZ * 2 + 2.6, -HX - 1.25, 0, Math.PI / 2);
    fascia(HZ * 2 + 2.6, HX + 1.25, 0, Math.PI / 2);
    // big sign over the entrance, facing the path (−x)
    const sign = makeSign("XE ĐIỆN ĐỤNG", 9, 1.8, "#e63946", "#fff", "{bumper} Tự lái · Đụng thoải mái!");
    sign.position.set(-HX - 1.35, ROOF_Y + 1.5, 0);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);

    // ticket booth by the entrance
    const booth = new THREE.Group();
    booth.position.set(-HX - 2.4, 0, -3.2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 1.6), std("#ffd166"));
    body.position.y = 1.1;
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1, 4), std("#e63946"));
    top.position.y = 2.7;
    top.rotation.y = Math.PI / 4;
    booth.add(body, top);
    booth.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    this.group.add(booth);
    this.colliders.push({ x: this.center.x - HX - 2.4, z: this.center.z - 3.2, r: 1.2 });

    // cars
    const sparkTex = canvasTexture(32, 32, (g) => {
      const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.3, "rgba(160,220,255,.9)");
      grd.addColorStop(1, "rgba(80,140,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 32, 32);
    });
    const sparkMat = new THREE.SpriteMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, depthWrite: false });
    const bodyGeo = new THREE.CylinderGeometry(1, 1, 0.42, 28);
    const bumperGeo = new THREE.TorusGeometry(1, 0.14, 8, 32);
    const seatGeo = new THREE.BoxGeometry(0.9, 0.18, 0.6);
    const backGeo = new THREE.BoxGeometry(0.95, 0.42, 0.16);
    const dashGeo = new THREE.BoxGeometry(1.0, 0.3, 0.4);
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, ROOF_Y - 1.0, 6);
    const wheelGeo = new THREE.TorusGeometry(0.17, 0.035, 6, 16);
    const black = std("#1b2340", { roughness: 0.95 });
    const chrome = std("#d8dee9", { metalness: 0.8, roughness: 0.25 });
    for (let i = 0; i < N_CARS; i++) {
      const g = new THREE.Group();
      const col = std(COLORS[i % COLORS.length], { metalness: 0.3, roughness: 0.35 });
      const b = new THREE.Mesh(bodyGeo, col);
      b.scale.set(0.78, 1, 1);
      b.position.y = 0.38;
      const bump = new THREE.Mesh(bumperGeo, black);
      bump.scale.set(0.8, 1.02, 1);
      bump.rotation.x = Math.PI / 2;
      bump.position.y = 0.3;
      const seat = new THREE.Mesh(seatGeo, black);
      seat.position.set(0, 0.62, -0.25);
      const back = new THREE.Mesh(backGeo, col);
      back.position.set(0, 0.8, -0.6);
      back.rotation.x = -0.15;
      const dash = new THREE.Mesh(dashGeo, col);
      dash.position.set(0, 0.7, 0.62);
      const pole = new THREE.Mesh(poleGeo, chrome);
      pole.position.set(0, 0.6 + (ROOF_Y - 1.0) / 2, -0.75);
      const wheel = new THREE.Mesh(wheelGeo, black);
      wheel.position.set(0, 0.98, 0.32);
      wheel.rotation.x = -0.9;
      const spark = new THREE.Sprite(sparkMat);
      spark.position.set(0, ROOF_Y - 0.1, -0.75);
      spark.visible = false;
      g.add(b, bump, seat, back, dash, pole, wheel, spark);
      g.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.group.add(g);
      this.cars.push({ g, spark });
    }
  }
}
