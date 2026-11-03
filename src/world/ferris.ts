import * as THREE from "three";
import { Collider, std } from "../util";

const N_GOND = 12;
const PERIOD = 80; // seconds per revolution
const R = 17;
const HUB_Y = 20.5;
const HANG = 2.6; // hinge → cabin floor

export class FerrisWheel {
  group = new THREE.Group();
  center: THREE.Vector3;
  colliders: Collider[] = [];
  boardZone: THREE.Vector3;
  exitPoint: THREE.Vector3;
  private rotor = new THREE.Group();
  private gondolas: THREE.Group[] = [];
  period = PERIOD;
  seats = 4;

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, HUB_Y, z);
    this.group.position.set(x, 0, z);
    this.boardZone = new THREE.Vector3(x, 0, z + 5.5);
    this.exitPoint = new THREE.Vector3(x + 2.5, 0, z + 6.5);
    this.build();
  }

  angle(i: number, now: number) {
    return (now / 1000 / PERIOD) * Math.PI * 2 + (i * Math.PI * 2) / N_GOND;
  }

  hinge(i: number, now: number, out: THREE.Vector3) {
    const a = this.angle(i, now);
    return out.set(this.center.x + Math.cos(a) * R, HUB_Y + Math.sin(a) * R, this.center.z);
  }

  /** Gondola closest to the bottom (boarding position). */
  bottomGondola(now: number) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N_GOND; i++) {
      const a = this.angle(i, now);
      const d = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private seatOffsets = [
    new THREE.Vector3(0.42, 0, 0.28),
    new THREE.Vector3(-0.42, 0, -0.28),
    new THREE.Vector3(-0.42, 0, 0.28),
    new THREE.Vector3(0.42, 0, -0.28),
  ];

  seatPose(key: string, seat: number, start: number, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const i = +(key.split(":")[1] ?? 0) % N_GOND;
    this.hinge(i, now, pos);
    const o = this.seatOffsets[seat % 4];
    pos.y -= HANG - 0.5;
    pos.x += o.x;
    pos.z += o.z;
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.z > 0 ? 0 : Math.PI);
    const elapsed = (now - start) / 1000;
    return { ok: true, done: elapsed > PERIOD, height: pos.y, left: Math.max(0, PERIOD - elapsed) };
  }

  update(now: number) {
    const a = (now / 1000 / PERIOD) * Math.PI * 2;
    this.rotor.rotation.z = a;
    const v = new THREE.Vector3();
    this.gondolas.forEach((g, i) => {
      this.hinge(i, now, v);
      g.position.set(v.x - this.center.x, v.y, 0);
      g.rotation.z = Math.sin(now / 900 + i) * 0.02;
    });
  }

  private build() {
    const white = std("#f8f9fa", { metalness: 0.4, roughness: 0.4 });
    const pink = std("#ff4e7a", { metalness: 0.2, roughness: 0.5 });
    // legs (A-frame)
    const legGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 10);
    legGeo.translate(0, 0.5, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const base = new THREE.Vector3(sx * 8, 0, sz * 4.5);
      const top = new THREE.Vector3(0, HUB_Y, sz * 1.6);
      const leg = new THREE.Mesh(legGeo, white);
      leg.position.copy(base);
      const dir = top.clone().sub(base);
      leg.scale.set(1, dir.length(), 1);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      leg.castShadow = true;
      this.group.add(leg);
      this.colliders.push({ x: this.group.position.x + base.x, z: this.group.position.z + base.z, r: 0.8 });
    }
    // rotor
    this.rotor.position.y = HUB_Y;
    this.group.add(this.rotor);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.6, 16), pink);
    hub.rotation.x = Math.PI / 2;
    this.rotor.add(hub);
    for (const z of [-1.3, 1.3]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 8, 96), white);
      rim.position.z = z;
      this.rotor.add(rim);
      const rim2 = new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.12, 6, 64), pink);
      rim2.position.z = z;
      this.rotor.add(rim2);
    }
    const spokeGeo = new THREE.CylinderGeometry(0.08, 0.08, R, 6);
    spokeGeo.translate(0, R / 2, 0);
    for (let i = 0; i < N_GOND * 2; i++) {
      for (const z of [-1.3, 1.3]) {
        const s = new THREE.Mesh(spokeGeo, white);
        s.rotation.z = (i / (N_GOND * 2)) * Math.PI * 2;
        s.position.z = z;
        this.rotor.add(s);
      }
    }
    // rim lights
    const bulbGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const colors = ["#ffd166", "#ff4e7a", "#2ec4b6", "#3a86ff", "#ffffff"];
    const nB = 96;
    const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: "#fff" }), nB * 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const z of [-1.55, 1.55]) for (let i = 0; i < nB; i++) {
      const a = (i / nB) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, z);
      bulbs.setMatrixAt(k, m);
      bulbs.setColorAt(k++, new THREE.Color(colors[i % colors.length]));
    }
    this.rotor.add(bulbs);
    this.rotor.traverse((o) => ((o as THREE.Mesh).isMesh && o !== bulbs && (o.castShadow = true)));

    // gondolas
    const gColors = ["#ff4e7a", "#ffd166", "#2ec4b6", "#3a86ff", "#8338ec", "#06d6a0"];
    const floorGeo = new THREE.CylinderGeometry(1.25, 1.1, 0.18, 16);
    const wallGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.75, 20, 1, true);
    const roofGeo = new THREE.ConeGeometry(1.5, 0.8, 16);
    const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6);
    const benchGeo = new THREE.BoxGeometry(1.5, 0.12, 0.42);
    const hangGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6);
    for (let i = 0; i < N_GOND; i++) {
      const g = new THREE.Group();
      const col = std(gColors[i % gColors.length], { side: THREE.DoubleSide });
      const floor = new THREE.Mesh(floorGeo, col);
      floor.position.y = -HANG;
      const wall = new THREE.Mesh(wallGeo, col);
      wall.position.y = -HANG + 0.42;
      const roof = new THREE.Mesh(roofGeo, col);
      roof.position.y = -HANG + 2.45;
      const hang = new THREE.Mesh(hangGeo, white);
      hang.position.y = -0.1;
      g.add(floor, wall, roof, hang);
      for (let p = 0; p < 4; p++) {
        const post = new THREE.Mesh(postGeo, white);
        const a = (p / 4) * Math.PI * 2 + Math.PI / 4;
        post.position.set(Math.cos(a) * 1.15, -HANG + 1.25, Math.sin(a) * 1.15);
        g.add(post);
      }
      for (const z of [-0.3, 0.3]) {
        const b = new THREE.Mesh(benchGeo, white);
        b.position.set(0, -HANG + 0.45, z);
        g.add(b);
      }
      g.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
      this.rotor.parent!.add(g);
      this.gondolas.push(g);
    }
    // boarding platform
    const plat = new THREE.Mesh(new THREE.BoxGeometry(7, 0.25, 9), std("#c9b79c"));
    plat.position.set(0, 0.06, 3);
    plat.receiveShadow = true;
    this.group.add(plat);
    this.colliders.push({ x: this.group.position.x, z: this.group.position.z, r: 2.4 });
  }
}
