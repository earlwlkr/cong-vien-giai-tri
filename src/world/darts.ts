import * as THREE from "three";
import { BoxCollider, makeSign, std } from "../util";

const COLS = 6, ROWS = 4;
export const DART_TIME = 45;

interface Balloon {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  gold: boolean;
  alive: boolean;
  respawnAt: number;
}
interface FlyingDart {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  target: Balloon | null;
}
interface Particle {
  m: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

export class Darts {
  group = new THREE.Group();
  boxes: BoxCollider[] = [];
  origin: THREE.Vector3;
  standPoint: THREE.Vector3;
  eye: THREE.Vector3;
  active = false;
  score = 0;
  timeLeft = 0;
  private endAt = 0;
  private balloons: Balloon[] = [];
  private darts: FlyingDart[] = [];
  private stuck: THREE.Object3D[] = [];
  private particles: Particle[] = [];
  private cooldown = 0;
  private ray = new THREE.Raycaster();
  private wallZ: number;
  private dartGeo: THREE.BufferGeometry;
  private dartMat = std("#ff4e7a");
  private shardGeo = new THREE.PlaneGeometry(0.12, 0.12);
  onPop: ((gold: boolean) => void) | null = null;
  onThrow: (() => void) | null = null;

  constructor(x: number, z: number) {
    this.origin = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.origin);
    this.standPoint = new THREE.Vector3(x, 0, z + 2.7);
    this.eye = new THREE.Vector3(x, 1.65, z + 2.9);
    this.wallZ = z - 3.3;
    const dart = new THREE.CylinderGeometry(0.015, 0.03, 0.35, 6);
    dart.rotateX(Math.PI / 2);
    this.dartGeo = dart;
    this.build();
  }

  private build() {
    const wood = std("#8d5a3b");
    const pinkWall = std("#ffe5ec");
    const back = new THREE.Mesh(new THREE.BoxGeometry(7, 4.6, 0.2), std("#3a0ca3"));
    back.position.set(0, 2.3, -3.5);
    const cork = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.6, 0.1), std("#d4a373"));
    cork.position.set(0, 2.3, -3.37);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.6, 5.4), pinkWall);
    left.position.set(-3.5, 2.3, -0.9);
    const right = left.clone();
    right.position.x = 3.5;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 1.05, 0.7), wood);
    counter.position.set(0, 0.52, 1.6);
    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 0.9), std("#ffd166"));
    counterTop.position.set(0, 1.08, 1.6);
    // striped awning
    const stripes = new THREE.CanvasTexture((() => {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 32;
      const g = c.getContext("2d")!;
      for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? "#fff" : "#3a86ff"; g.fillRect(i * 25.6, 0, 25.6, 32); }
      return c;
    })());
    stripes.colorSpace = THREE.SRGBColorSpace;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 3), new THREE.MeshStandardMaterial({ map: stripes }));
    awning.position.set(0, 4.75, 1.2);
    awning.rotation.x = 0.25;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.2, 5.4), std("#ffffff"));
    roof.position.set(0, 4.65, -0.9);
    const sign = makeSign("NÉM PHI TIÊU", 6, 1.3, "#3a86ff", "#fff", "🎯 Bắn bóng bay · Lên bảng vàng");
    sign.position.set(0, 5.6, 2.2);
    this.group.add(back, cork, left, right, counter, counterTop, awning, roof, sign);
    // prizes: teddy bears on side shelves
    const bearColors = ["#c08552", "#f4acb7", "#9ad1d4", "#ffd166"];
    for (let i = 0; i < 6; i++) {
      const bear = new THREE.Group();
      const m = std(bearColors[i % bearColors.length]);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), m);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), m);
      h.position.y = 0.38;
      const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), m);
      e1.position.set(0.14, 0.53, 0);
      const e2 = e1.clone();
      e2.position.x = -0.14;
      bear.add(b, h, e1, e2);
      const side = i < 3 ? -1 : 1;
      bear.position.set(side * 3.15, 1.6 + (i % 3) * 0.9, -2.2 + (i % 3) * 1.2);
      bear.rotation.y = -side * Math.PI / 2;
      this.group.add(bear);
    }
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    const O = this.origin;
    this.boxes.push({ minX: O.x - 3.7, maxX: O.x + 3.7, minZ: O.z - 3.7, maxZ: O.z + 2.05 });

    // balloons
    const geo = new THREE.SphereGeometry(0.27, 16, 12);
    geo.scale(1, 1.18, 1);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const mesh = new THREE.Mesh(geo, std("#ff4e7a", { roughness: 0.25, metalness: 0.1 }));
      const home = new THREE.Vector3(O.x + (c - (COLS - 1) / 2) * 0.95, 1.15 + r * 0.82, this.wallZ + 0.1);
      mesh.position.copy(home);
      mesh.castShadow = true;
      this.balloons.push({ mesh, home, gold: false, alive: true, respawnAt: 0 });
      this.recolor(this.balloons[this.balloons.length - 1]);
      this.group.parent; // no-op
    }
  }

  attach(scene: THREE.Scene) {
    scene.add(this.group);
    for (const b of this.balloons) scene.add(b.mesh);
  }

  private recolor(b: Balloon) {
    const colors = ["#ff4e7a", "#ff9f1c", "#2ec4b6", "#3a86ff", "#8338ec", "#06d6a0", "#ef476f"];
    b.gold = Math.random() < 0.12;
    const mat = b.mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(b.gold ? "#ffd700" : colors[Math.floor(Math.random() * colors.length)]);
    mat.metalness = b.gold ? 0.8 : 0.1;
    mat.emissive.set(b.gold ? "#553300" : "#000000");
  }

  start() {
    this.active = true;
    this.score = 0;
    this.timeLeft = DART_TIME;
    this.endAt = performance.now() + DART_TIME * 1000;
    this.cooldown = 0;
    for (const s of this.stuck) s.removeFromParent();
    this.stuck = [];
    for (const b of this.balloons) {
      b.alive = true;
      b.mesh.visible = true;
      this.recolor(b);
    }
  }

  stop() {
    this.active = false;
    for (const d of this.darts) d.obj.removeFromParent();
    this.darts = [];
  }

  throwAt(ndcX: number, ndcY: number, camera: THREE.Camera, scene: THREE.Scene) {
    if (!this.active || this.cooldown > 0) return;
    this.cooldown = 0.28;
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const alive = this.balloons.filter((b) => b.alive).map((b) => b.mesh);
    const hit = this.ray.intersectObjects(alive, false)[0];
    let to: THREE.Vector3;
    let target: Balloon | null = null;
    if (hit) {
      to = hit.point.clone();
      target = this.balloons.find((b) => b.mesh === hit.object) ?? null;
    } else {
      const t = (this.wallZ + 0.05 - this.ray.ray.origin.z) / this.ray.ray.direction.z;
      to = this.ray.ray.at(t > 0 ? Math.min(t, 30) : 8, new THREE.Vector3());
    }
    const from = camera.position.clone().add(new THREE.Vector3(0.25, -0.35, -0.3));
    const obj = new THREE.Mesh(this.dartGeo, this.dartMat);
    obj.position.copy(from);
    obj.lookAt(to);
    scene.add(obj);
    this.darts.push({ obj, from, to, t: 0, dur: from.distanceTo(to) / 28, target });
    this.onThrow?.();
  }

  update(dt: number, now: number, scene: THREE.Scene) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.active) this.timeLeft = Math.max(0, (this.endAt - performance.now()) / 1000);
    // bob balloons, gold ones drift
    const t = now / 1000;
    this.balloons.forEach((b, i) => {
      if (!b.alive) {
        if (t > b.respawnAt) {
          b.alive = true;
          b.mesh.visible = true;
          b.mesh.scale.setScalar(0.01);
          this.recolor(b);
        }
        return;
      }
      b.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-dt * 8));
      const dx = b.gold ? Math.sin(t * 2.2 + i) * 0.35 : 0;
      b.mesh.position.set(b.home.x + dx, b.home.y + Math.sin(t * 1.7 + i * 0.9) * 0.05, b.home.z);
    });
    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      d.obj.position.lerpVectors(d.from, d.to, k);
      d.obj.position.y += Math.sin(k * Math.PI) * 0.15;
      if (k >= 1) {
        this.darts.splice(i, 1);
        if (d.target && d.target.alive && d.target.mesh.position.distanceTo(d.to) < 0.6) {
          this.pop(d.target, now, scene);
          d.obj.removeFromParent();
        } else {
          d.obj.position.z = Math.max(d.obj.position.z, this.wallZ + 0.05);
          this.stuck.push(d.obj);
          if (this.stuck.length > 25) this.stuck.shift()!.removeFromParent();
        }
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.v.y -= 9 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += dt * 8;
      p.m.rotation.y += dt * 6;
      if (p.life <= 0) {
        p.m.removeFromParent();
        (p.m.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  private pop(b: Balloon, now: number, scene: THREE.Scene) {
    b.alive = false;
    b.mesh.visible = false;
    b.respawnAt = now / 1000 + 1.0 + Math.random();
    if (this.active) this.score += b.gold ? 30 : 10;
    const col = (b.mesh.material as THREE.MeshStandardMaterial).color;
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(this.shardGeo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.copy(b.mesh.position);
      scene.add(m);
      this.particles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, Math.random() * 3), life: 0.8 });
    }
    this.onPop?.(b.gold);
  }
}
