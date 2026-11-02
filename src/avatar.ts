import * as THREE from "three";
import { makeLabel, disposeLabel, shade, std } from "./util";

export type Pose = "idle" | "walk" | "run" | "jump" | "sit" | "cheer" | "horse" | "throw";

const SCALE = 0.9;
export const HIP_HEIGHT = 0.9 * SCALE;
export const EYE_OFFSET = 0.95 * SCALE; // from hip to eyes
export const EYE_HEIGHT = HIP_HEIGHT + EYE_OFFSET;

const skinTones = ["#f1c27d", "#e0ac69", "#ffdbac", "#c68642", "#8d5524"];
const hairColors = ["#2b1b10", "#4a2f1b", "#111111", "#8a5a2b", "#d9a441"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Avatar {
  group = new THREE.Group();
  private hips = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  head = new THREE.Group();
  private torso: THREE.Mesh;
  label: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private phase = 0;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];

  constructor(public name: string, public color: string, seed = name) {
    const h = hash(seed + color);
    const shirt = std(color);
    const pants = std(shade(color, -35), { roughness: 0.9 });
    const skin = std(skinTones[h % skinTones.length], { roughness: 0.6 });
    const shoe = std("#2d2d36");
    const hair = std(hairColors[(h >> 4) % hairColors.length]);
    const dark = new THREE.MeshBasicMaterial({ color: "#1b1b24" });
    this.mats.push(shirt, pants, skin, shoe, hair, dark);

    const g = <T extends THREE.BufferGeometry>(x: T) => (this.geos.push(x), x);
    const legGeo = g(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8));
    const shoeGeo = g(new THREE.BoxGeometry(0.17, 0.12, 0.3));
    const armGeo = g(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8));
    const handGeo = g(new THREE.SphereGeometry(0.08, 8, 6));
    const torsoGeo = g(new THREE.CapsuleGeometry(0.23, 0.32, 6, 12));
    const headGeo = g(new THREE.SphereGeometry(0.23, 16, 12));
    const eyeGeo = g(new THREE.SphereGeometry(0.035, 8, 6));
    const hairGeo = g(new THREE.SphereGeometry(0.245, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52));
    const capBrim = g(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 16, 1, false, -Math.PI / 2, Math.PI));

    this.group.add(this.hips);
    this.hips.position.y = 0.9;

    for (const [leg, x] of [[this.legL, 0.12], [this.legR, -0.12]] as const) {
      leg.position.set(x, 0, 0);
      const m = new THREE.Mesh(legGeo, pants);
      m.position.y = -0.41;
      const s = new THREE.Mesh(shoeGeo, shoe);
      s.position.set(0, -0.84, 0.06);
      leg.add(m, s);
      this.hips.add(leg);
    }
    this.torso = new THREE.Mesh(torsoGeo, shirt);
    this.torso.position.y = 0.36;
    this.hips.add(this.torso);
    for (const [arm, x] of [[this.armL, 0.31], [this.armR, -0.31]] as const) {
      arm.position.set(x, 0.62, 0);
      const m = new THREE.Mesh(armGeo, shirt);
      m.position.y = -0.26;
      const hd = new THREE.Mesh(handGeo, skin);
      hd.position.y = -0.55;
      arm.add(m, hd);
      this.hips.add(arm);
    }
    this.head.position.y = 0.98;
    const headM = new THREE.Mesh(headGeo, skin);
    const hairM = new THREE.Mesh(hairGeo, (h >> 8) % 3 === 0 ? std(shade(color, -10)) : hair);
    hairM.rotation.x = -0.25;
    hairM.position.set(0, 0.02, -0.02);
    const e1 = new THREE.Mesh(eyeGeo, dark);
    const e2 = new THREE.Mesh(eyeGeo, dark);
    e1.position.set(0.08, 0.02, 0.2);
    e2.position.set(-0.08, 0.02, 0.2);
    this.head.add(headM, hairM, e1, e2);
    if ((h >> 8) % 3 === 0) {
      const brim = new THREE.Mesh(capBrim, std(shade(color, -10)));
      brim.position.set(0, 0.07, 0.12);
      brim.rotation.x = 0.15;
      this.head.add(brim);
    }
    this.hips.add(this.head);
    this.group.scale.setScalar(SCALE);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    this.label = makeLabel(name, { height: 0.32, font: 40 });
    this.label.position.y = 2.15;
    this.group.add(this.label);
  }

  say(text: string, now: number) {
    if (this.bubble) {
      this.group.remove(this.bubble);
      disposeLabel(this.bubble);
    }
    this.bubble = makeLabel(text, { bg: "rgba(255,255,255,0.95)", color: "#1b2340", tail: true, height: 0.3, font: 38, maxWidth: 520 });
    this.bubble.position.y = 2.55;
    this.group.add(this.bubble);
    this.bubbleUntil = now + 7000;
  }

  setFirstPerson(fp: boolean) {
    this.head.visible = !fp;
    this.label.visible = !fp;
    if (this.bubble) this.bubble.visible = !fp;
  }

  animate(pose: Pose, speed: number, dt: number, now: number) {
    if (this.bubble && now > this.bubbleUntil) {
      this.group.remove(this.bubble);
      disposeLabel(this.bubble);
      this.bubble = null;
    }
    const k = 1 - Math.exp(-dt * 14);
    const set = (o: THREE.Object3D, x: number, z = 0) => {
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    let hipY = 0.9;
    let lean = 0;
    switch (pose) {
      case "walk":
      case "run": {
        const run = pose === "run";
        this.phase += dt * (run ? 11 : 7.5) * Math.max(0.6, speed);
        const a = Math.sin(this.phase) * (run ? 0.85 : 0.55);
        set(this.legL, a);
        set(this.legR, -a);
        set(this.armL, -a * 0.9, 0.08);
        set(this.armR, a * 0.9, -0.08);
        hipY = 0.9 + Math.abs(Math.cos(this.phase)) * (run ? 0.07 : 0.04);
        lean = run ? 0.18 : 0.05;
        break;
      }
      case "jump":
        set(this.legL, -0.5);
        set(this.legR, 0.25);
        set(this.armL, -2.6, 0.3);
        set(this.armR, -2.6, -0.3);
        break;
      case "sit":
        set(this.legL, -1.45, 0.05);
        set(this.legR, -1.45, -0.05);
        set(this.armL, -0.7, 0.1);
        set(this.armR, -0.7, -0.1);
        break;
      case "cheer": {
        this.phase += dt * 6;
        set(this.legL, -1.45, 0.05);
        set(this.legR, -1.45, -0.05);
        set(this.armL, -2.9 + Math.sin(this.phase) * 0.2, 0.35);
        set(this.armR, -2.9 - Math.sin(this.phase) * 0.2, -0.35);
        break;
      }
      case "horse":
        set(this.legL, -0.35, 0.55);
        set(this.legR, -0.35, -0.55);
        set(this.armL, -1.0, -0.1);
        set(this.armR, -1.0, 0.1);
        break;
      case "throw":
        this.phase += dt * 3;
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, -0.2, 0.1);
        set(this.armR, -2.2 + Math.sin(this.phase) * 0.3, 0);
        break;
      default: {
        this.phase += dt * 2;
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, 0, 0.08 + Math.sin(this.phase) * 0.03);
        set(this.armR, 0, -0.08 - Math.sin(this.phase) * 0.03);
        hipY = 0.9 + Math.sin(this.phase) * 0.01;
      }
    }
    if (pose === "sit" || pose === "cheer" || pose === "horse") hipY = 0.9;
    this.hips.position.y = hipY;
    this.hips.rotation.x += (lean - this.hips.rotation.x) * k;
  }

  dispose() {
    this.group.removeFromParent();
    disposeLabel(this.label);
    if (this.bubble) disposeLabel(this.bubble);
    this.mats.forEach((m) => m.dispose());
    this.geos.forEach((g) => g.dispose());
  }
}
