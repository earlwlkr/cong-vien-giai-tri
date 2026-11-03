import * as THREE from "three";
import { Collider, std } from "../util";

const N = 12;
const PERIOD = 22;
const RADIUS = 5.2;
const DECK = 0.55;

export class Carousel {
  group = new THREE.Group();
  colliders: Collider[] = [];
  center: THREE.Vector3;
  private spinner = new THREE.Group();
  private horses: THREE.Group[] = [];
  private poles: THREE.Mesh[] = [];

  constructor(x: number, z: number) {
    this.center = new THREE.Vector3(x, 0, z);
    this.group.position.copy(this.center);
    this.colliders.push({ x, z, r: 8.2 });
    this.build();
  }

  angle(i: number, now: number) {
    return (now / 1000 / PERIOD) * Math.PI * 2 + (i * Math.PI * 2) / N;
  }
  bob(i: number, now: number) {
    return 0.3 * Math.sin((now / 1000) * 2.4 + i * 1.7);
  }

  /** Horse index nearest to a world point, skipping taken ones. */
  nearestHorse(x: number, z: number, now: number, taken: Set<number>) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (taken.has(i)) continue;
      const a = this.angle(i, now);
      const hx = this.center.x + Math.cos(a) * RADIUS, hz = this.center.z + Math.sin(a) * RADIUS;
      const d = (hx - x) ** 2 + (hz - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  seatPose(key: string, now: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const i = +(key.split(":")[1] ?? 0) % N;
    const a = this.angle(i, now);
    pos.set(this.center.x + Math.cos(a) * RADIUS, DECK + 1.25 + this.bob(i, now), this.center.z + Math.sin(a) * RADIUS);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    return { ok: true, done: false };
  }

  exitFor(key: string, now: number, out: THREE.Vector3) {
    const i = +(key.split(":")[1] ?? 0) % N;
    const a = this.angle(i, now);
    return out.set(this.center.x + Math.cos(a) * 9.5, 0, this.center.z + Math.sin(a) * 9.5);
  }

  update(now: number) {
    const base = (now / 1000 / PERIOD) * Math.PI * 2;
    this.spinner.rotation.y = -base;
    this.horses.forEach((h, i) => {
      h.position.y = DECK + 1.0 + this.bob(i, now);
    });
  }

  private build() {
    const gold = std("#f4c95d", { metalness: 0.7, roughness: 0.3 });
    const white = std("#fff8f0");
    // base (static)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(7.8, 8, 0.35, 40), std("#b5838d"));
    base.position.y = 0.17;
    base.receiveShadow = true;
    this.group.add(base);
    this.group.add(this.spinner);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.3, 0.25, 40), std("#fde2e4"));
    deck.position.y = DECK - 0.1;
    deck.receiveShadow = true;
    this.spinner.add(deck);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.2, 16), std("#e5989b"));
    core.position.y = DECK + 2.6;
    this.spinner.add(core);
    // mirrored panels on core
    const panel = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 1.2, 16, 1, true), std("#ffd6e0", { metalness: 0.6, roughness: 0.2 }));
    panel.position.y = DECK + 3.4;
    this.spinner.add(panel);
    // canopy with stripes
    const stripes = new THREE.CanvasTexture((() => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 64;
      const g = c.getContext("2d")!;
      for (let i = 0; i < 16; i++) {
        g.fillStyle = i % 2 ? "#ffffff" : "#ff4e7a";
        g.fillRect((i * 512) / 16, 0, 512 / 16, 64);
      }
      return c;
    })());
    stripes.colorSpace = THREE.SRGBColorSpace;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(8.4, 3.2, 32, 1, true), new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.7 }));
    roof.position.y = DECK + 6.6;
    this.spinner.add(roof);
    const valance = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 0.7, 40, 1, true), gold);
    valance.position.y = DECK + 4.85;
    this.spinner.add(valance);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), gold);
    top.position.y = DECK + 8.4;
    this.spinner.add(top);
    // bulbs on valance
    const nb = 48;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: "#fff6c2" }), nb);
    const m = new THREE.Matrix4();
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * 8.5, DECK + 4.5, Math.sin(a) * 8.5);
      bulbs.setMatrixAt(i, m);
    }
    this.spinner.add(bulbs);

    // horses
    const horseColors = ["#ffffff", "#f7d6e0", "#cde7f0", "#fff1b5", "#d8c3a5", "#e2ece9"];
    const maneColors = ["#ff4e7a", "#8338ec", "#3a86ff", "#ff9f1c", "#2ec4b6"];
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 4.6, 8);
    for (let i = 0; i < N; i++) {
      const a = (i * Math.PI * 2) / N;
      const pole = new THREE.Mesh(poleGeo, gold);
      pole.position.set(Math.cos(a) * RADIUS, DECK + 2.3, Math.sin(a) * RADIUS);
      this.spinner.add(pole);
      this.poles.push(pole);
      const h = this.makeHorse(horseColors[i % horseColors.length], maneColors[i % maneColors.length]);
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS);
      // spinner rotates by -base → world angle = a + base (matches angle()); face the direction of travel.
      holder.rotation.y = -a;
      holder.add(h);
      this.spinner.add(holder);
      this.horses.push(h);
    }
    this.spinner.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    void white;
  }

  private makeHorse(color: string, mane: string) {
    const g = new THREE.Group();
    const body = std(color, { roughness: 0.4 });
    const maneM = std(mane);
    const saddle = std("#c1121f");
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 10), body);
    b.rotation.x = Math.PI / 2;
    g.add(b);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 8), body);
    neck.position.set(0, 0.42, 0.6);
    neck.rotation.x = -0.6;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.55), body);
    head.position.set(0, 0.72, 0.85);
    head.rotation.x = 0.4;
    g.add(head);
    const mn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.3), maneM);
    mn.position.set(0, 0.55, 0.5);
    mn.rotation.x = -0.6;
    g.add(mn);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 6), maneM);
    tail.position.set(0, 0.0, -0.85);
    tail.rotation.x = -2.3;
    g.add(tail);
    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.75, 6);
    for (const [x, z, r] of [[0.16, 0.38, 0.6], [-0.16, 0.38, 0.2], [0.16, -0.38, -0.4], [-0.16, -0.38, -0.1]]) {
      const l = new THREE.Mesh(legGeo, body);
      l.position.set(x, -0.45, z);
      l.rotation.x = r;
      g.add(l);
    }
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), saddle);
    s.position.set(0, 0.32, -0.05);
    g.add(s);
    return g;
  }
}
