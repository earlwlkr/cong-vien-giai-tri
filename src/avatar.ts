import * as THREE from "three";
import { makeLabel, disposeLabel, shade, std } from "./util";

export type Pose = "idle" | "walk" | "run" | "jump" | "sit" | "cheer" | "horse" | "throw" | "wave" | "serve";

// Chibi proportions: short legs, round body, big head.
const SCALE = 0.95;
const HIP = 0.51; // unscaled hip height above the feet
const NECK = 0.6; // head pivot above the hips
const HEAD_R = 0.4;
const HEAD_CY = 0.36; // head centre above the neck pivot
export const HIP_HEIGHT = HIP * SCALE;
export const EYE_OFFSET = (NECK + HEAD_CY - 0.03) * SCALE; // from hip to eyes
export const EYE_HEIGHT = HIP_HEIGHT + EYE_OFFSET;

const skinTones = ["#ffcfae", "#f8bf96", "#efb07c", "#dd9a62", "#c07f4a", "#93603a"];
const hairColors = ["#3b2a20", "#5a3a22", "#1f1b24", "#a0663a", "#e8b44a", "#d96c4f"];

type HairStyle = "tuft" | "buns" | "catHood" | "bow" | "bearHood";
const HAIR_STYLES: HairStyle[] = ["tuft", "buns", "catHood", "bow", "bearHood"];

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
  private eyes: THREE.Object3D[] = [];
  private happyEyes: THREE.Object3D[] = [];
  label: THREE.Sprite;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private phase = 0;
  private nextBlink = 0;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  /** Item in the right hand (kept upright while the arm moves). */
  private held: THREE.Object3D | null = null;
  heldKey = "";
  private eatUntil = 0;
  private chew = 0;
  private puffs: { s: THREE.Sprite; t: number }[] = [];

  constructor(public name: string, public color: string, seed = name) {
    const h = hash(seed + color);
    const style = HAIR_STYLES[h % HAIR_STYLES.length];
    // a touch of self-glow keeps the toy-like colours bright on the shadowed side
    const soft = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = std(c, { roughness: 0.85, emissive: c, emissiveIntensity: 0.14, ...extra });
      this.mats.push(m);
      return m;
    };
    const flat = (c: THREE.ColorRepresentation, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity });
      this.mats.push(m);
      return m;
    };
    const g = <T extends THREE.BufferGeometry>(x: T) => (this.geos.push(x), x);

    const shirt = soft(color);
    const tummy = soft(shade(color, 22));
    const pants = soft(shade(color, -32));
    const skin = soft(skinTones[(h >>> 3) % skinTones.length], { roughness: 0.7, emissiveIntensity: 0.2 });
    const shoe = soft(["#ffffff", "#2d2d36", "#ff7eb6", "#ffd166"][(h >>> 6) % 4]);
    const hairCol = (h >>> 9) % 4 === 0 ? shade(color, -15) : hairColors[(h >>> 9) % hairColors.length];
    const hair = soft(hairCol);
    const ink = flat("#2a1f2d");
    const white = flat("#ffffff");
    const blush = flat("#ff8fa3", 0.55);
    const earPink = soft("#ffb3c6");

    const sphere = g(new THREE.SphereGeometry(1, 20, 14));
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      return m;
    };

    this.group.add(this.hips);
    this.hips.position.y = HIP;

    // legs: stubby with round shoes
    const legGeo = g(new THREE.CapsuleGeometry(0.095, 0.2, 4, 10));
    for (const [leg, x] of [[this.legL, 0.11], [this.legR, -0.11]] as const) {
      leg.position.set(x, 0, 0);
      leg.add(mesh(legGeo, pants, 0, -0.22, 0));
      leg.add(mesh(sphere, shoe, 0, -0.43, 0.04, 0.12, 0.085, 0.16));
      this.hips.add(leg);
    }

    // round body with a lighter tummy patch
    const body = mesh(g(new THREE.CapsuleGeometry(0.25, 0.12, 8, 16)), shirt, 0, 0.27, 0, 1.06, 1, 0.92);
    const belly = mesh(sphere, tummy, 0, 0.22, 0.17, 0.16, 0.17, 0.08);
    this.hips.add(body, belly);

    // little arms with mitten hands
    const armGeo = g(new THREE.CapsuleGeometry(0.07, 0.15, 4, 10));
    for (const [arm, x] of [[this.armL, 0.28], [this.armR, -0.28]] as const) {
      arm.position.set(x, 0.45, 0);
      arm.add(mesh(armGeo, shirt, 0, -0.13, 0));
      arm.add(mesh(sphere, skin, 0, -0.29, 0, 0.085));
      this.hips.add(arm);
    }

    // big round head
    this.head.position.y = NECK;
    const C = new THREE.Vector3(0, HEAD_CY, 0);
    this.head.add(mesh(sphere, skin, 0, HEAD_CY, 0, HEAD_R * 1.04, HEAD_R, HEAD_R));
    /** Point on the head surface in direction (x, y, z), pushed out by `out`. */
    const onHead = (x: number, y: number, z: number, out = 0) =>
      new THREE.Vector3(x, y, z).normalize().multiplyScalar(HEAD_R + out).add(C);
    const facing = (m: THREE.Object3D, dir: THREE.Vector3) => {
      m.lookAt(dir.clone().sub(C).multiplyScalar(10).add(C));
      return m;
    };

    // face: sparkly eyes, rosy cheeks, tiny smile
    for (const side of [1, -1]) {
      const eyeDir = new THREE.Vector3(side * 0.36, -0.08, 0.93);
      const eye = new THREE.Group();
      eye.position.copy(onHead(eyeDir.x, eyeDir.y, eyeDir.z, -0.01));
      facing(eye, eye.position);
      eye.add(mesh(sphere, ink, 0, 0, 0, 0.058, 0.078, 0.03));
      eye.add(mesh(sphere, white, side * 0.018, 0.028, 0.026, 0.02));
      eye.add(mesh(sphere, white, -side * 0.02, -0.03, 0.024, 0.01));
      this.head.add(eye);
      this.eyes.push(eye);

      const happy = mesh(g(new THREE.TorusGeometry(0.05, 0.014, 6, 14, Math.PI)), ink);
      happy.position.copy(eye.position);
      facing(happy, happy.position);
      happy.visible = false;
      this.head.add(happy);
      this.happyEyes.push(happy);

      const cheek = mesh(sphere, blush, 0, 0, 0, 0.07, 0.042, 0.01);
      cheek.position.copy(onHead(side * 0.6, -0.33, 0.73, 0.004));
      facing(cheek, cheek.position);
      this.head.add(cheek);
    }
    const smile = mesh(g(new THREE.TorusGeometry(0.04, 0.012, 6, 12, Math.PI)), ink);
    smile.position.copy(onHead(0, -0.36, 0.93, 0.002));
    facing(smile, smile.position);
    smile.rotateZ(Math.PI);
    this.head.add(smile);

    // hair / hoods
    const cap = (mat: THREE.Material, coverage: number, tilt: number, r = HEAD_R + 0.025) => {
      const m = mesh(g(new THREE.SphereGeometry(r, 24, 14, 0, Math.PI * 2, 0, Math.PI * coverage)), mat, 0, HEAD_CY, 0);
      m.scale.x = 1.04;
      m.rotation.x = tilt;
      return m;
    };
    const top = HEAD_CY + HEAD_R;
    if (style === "catHood" || style === "bearHood") {
      const hood = soft(shade(color, -8));
      this.head.add(cap(hood, 0.56, -0.55, HEAD_R + 0.04));
      for (const side of [1, -1]) {
        if (style === "catHood") {
          const ear = mesh(g(new THREE.ConeGeometry(0.13, 0.24, 4)), hood, side * 0.25, top + 0.06, -0.04);
          ear.rotation.set(0, Math.PI / 4, -side * 0.42);
          const inner = mesh(g(new THREE.ConeGeometry(0.07, 0.14, 4)), earPink, side * 0.245, top + 0.04, 0.03);
          inner.rotation.set(0, Math.PI / 4, -side * 0.42);
          this.head.add(ear, inner);
        } else {
          this.head.add(mesh(sphere, hood, side * 0.28, top - 0.06, -0.06, 0.12, 0.12, 0.07));
          this.head.add(mesh(sphere, earPink, side * 0.28, top - 0.07, -0.0, 0.07, 0.07, 0.03));
        }
      }
    } else {
      this.head.add(cap(hair, 0.5, -0.32));
      // fringe bumps across the forehead
      for (const x of [-0.2, -0.07, 0.07, 0.2]) {
        const f = mesh(sphere, hair, 0, 0, 0, 0.1, 0.08, 0.06);
        f.position.copy(onHead(x, 0.42, 0.82, -0.02));
        facing(f, f.position);
        this.head.add(f);
      }
      if (style === "tuft") {
        // springy curl on top, facing forward so it reads from the front
        const tuft = mesh(g(new THREE.TorusGeometry(0.08, 0.035, 8, 16, Math.PI * 1.4)), hair, 0.03, top + 0.07, -0.02);
        tuft.rotation.set(0, 0, -0.3);
        this.head.add(tuft);
      } else if (style === "buns") {
        for (const side of [1, -1]) this.head.add(mesh(sphere, hair, side * 0.3, top - 0.06, -0.08, 0.13));
      } else {
        const bowMat = soft((h >>> 12) % 2 ? "#ff7eb6" : shade(color, 18));
        const bow = new THREE.Group();
        bow.position.set(0.24, top - 0.06, 0.12);
        bow.rotation.z = -0.5;
        for (const s of [1, -1]) {
          const loop = mesh(g(new THREE.ConeGeometry(0.075, 0.14, 12)), bowMat, s * 0.07, 0, 0);
          loop.rotation.z = (s * Math.PI) / 2;
          bow.add(loop);
        }
        bow.add(mesh(sphere, bowMat, 0, 0, 0, 0.04));
        this.head.add(bow);
      }
    }

    this.hips.add(this.head);
    this.group.scale.setScalar(SCALE);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material !== blush) o.castShadow = true;
    });

    this.label = makeLabel(name, { height: 0.32, font: 40 });
    this.label.position.y = 2.0;
    this.group.add(this.label);
  }

  say(text: string, now: number) {
    if (this.bubble) {
      this.group.remove(this.bubble);
      disposeLabel(this.bubble);
    }
    this.bubble = makeLabel(text, { bg: "rgba(255,255,255,0.95)", color: "#1b2340", tail: true, height: 0.3, font: 38, maxWidth: 520 });
    this.bubble.position.y = 2.4;
    this.group.add(this.bubble);
    this.bubbleUntil = now + 7000;
  }

  /** Seller headwear. */
  addHat(kind: "nonla" | "chef" | "cap" | "none", color = "#ffffff") {
    if (kind === "none") return;
    const top = HEAD_CY + HEAD_R;
    const m = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      this.geos.push(geo);
      this.mats.push(mat);
      const o = new THREE.Mesh(geo, mat);
      o.castShadow = true;
      return o;
    };
    if (kind === "nonla") {
      // conical leaf hat, wider than the head
      const hat = m(new THREE.ConeGeometry(0.62, 0.36, 24, 1, true), std("#e8d29a", { side: THREE.DoubleSide, roughness: 0.9 }));
      hat.position.y = top + 0.02;
      const band = m(new THREE.TorusGeometry(0.36, 0.018, 6, 24), std("#c0392b"));
      band.rotation.x = Math.PI / 2;
      band.position.y = top - 0.06;
      this.head.add(hat, band);
    } else if (kind === "chef") {
      const white = std("#ffffff", { roughness: 0.9, emissive: "#ffffff", emissiveIntensity: 0.15 });
      const base = m(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20), white);
      base.position.y = top - 0.02;
      const puff = m(new THREE.SphereGeometry(0.34, 16, 10), white);
      puff.scale.y = 0.7;
      puff.position.y = top + 0.18;
      this.head.add(base, puff);
    } else {
      const capMat = std(color, { roughness: 0.8 });
      const dome = m(new THREE.SphereGeometry(HEAD_R + 0.04, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), capMat);
      dome.position.y = HEAD_CY + 0.02;
      dome.rotation.x = -0.18;
      const brim = m(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 20, 1, false, -Math.PI / 2, Math.PI), capMat);
      brim.scale.z = 1.3;
      brim.position.set(0, HEAD_CY + HEAD_R * 0.55, HEAD_R * 0.62);
      this.head.add(dome, brim);
    }
  }

  /** Puts `obj` in the right hand; `key` lets callers skip rebuilding an unchanged item. Item meshes use shared resources. */
  setHeld(obj: THREE.Object3D | null, key = "") {
    if (this.held) this.armR.remove(this.held);
    this.held = obj;
    this.heldKey = key;
    if (obj) {
      obj.position.set(0, -0.33, 0.02);
      this.armR.add(obj);
    }
  }
  get heldObject() {
    return this.held;
  }

  /** Brings the held item to the mouth for a moment; layers on top of any pose. */
  eat(now: number, ms = 900) {
    this.eatUntil = now + ms;
  }

  /** Little floating text (e.g. "măm!") that rises and fades. */
  puff(text: string, now: number, color = "#ffffff") {
    const s = makeLabel(text, { bg: "rgba(255,120,80,0.92)", color, height: 0.24, font: 34 });
    s.position.set((Math.random() - 0.5) * 0.4, 2.35, 0);
    this.group.add(s);
    this.puffs.push({ s, t: now });
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
    let hipY = HIP;
    let lean = 0;
    let tilt = 0;
    switch (pose) {
      case "walk":
      case "run": {
        const run = pose === "run";
        this.phase += dt * (run ? 12 : 8.5) * Math.max(0.6, speed);
        const a = Math.sin(this.phase) * (run ? 0.95 : 0.65);
        set(this.legL, a);
        set(this.legR, -a);
        set(this.armL, -a * 1.1, 0.2);
        set(this.armR, a * 1.1, -0.2);
        hipY = HIP + Math.abs(Math.cos(this.phase)) * (run ? 0.09 : 0.06);
        lean = run ? 0.16 : 0.04;
        tilt = Math.sin(this.phase) * 0.06;
        break;
      }
      case "jump":
        set(this.legL, -0.6);
        set(this.legR, 0.3);
        set(this.armL, -2.7, 0.45);
        set(this.armR, -2.7, -0.45);
        break;
      case "sit":
        set(this.legL, -1.5, 0.12);
        set(this.legR, -1.5, -0.12);
        set(this.armL, -0.6, 0.15);
        set(this.armR, -0.6, -0.15);
        break;
      case "cheer": {
        this.phase += dt * 7;
        set(this.legL, -1.5, 0.12);
        set(this.legR, -1.5, -0.12);
        set(this.armL, -2.8 + Math.sin(this.phase) * 0.25, 0.5);
        set(this.armR, -2.8 - Math.sin(this.phase) * 0.25, -0.5);
        tilt = Math.sin(this.phase * 0.5) * 0.12;
        break;
      }
      case "horse":
        set(this.legL, -0.3, 0.6);
        set(this.legR, -0.3, -0.6);
        set(this.armL, -1.1, -0.15);
        set(this.armR, -1.1, 0.15);
        break;
      case "wave": {
        this.phase += dt * 10;
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, 0, 0.18);
        set(this.armR, -0.2, -2.5 + Math.sin(this.phase) * 0.35);
        tilt = 0.1;
        break;
      }
      case "serve":
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, -1.25, 0.1);
        set(this.armR, -1.25, -0.1);
        lean = 0.12;
        break;
      case "throw":
        this.phase += dt * 3;
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, -0.2, 0.15);
        set(this.armR, -2.2 + Math.sin(this.phase) * 0.3, 0);
        break;
      default: {
        this.phase += dt * 2.2;
        set(this.legL, 0);
        set(this.legR, 0);
        set(this.armL, 0, 0.18 + Math.sin(this.phase) * 0.05);
        set(this.armR, 0, -0.18 - Math.sin(this.phase) * 0.05);
        hipY = HIP + Math.sin(this.phase) * 0.012;
        tilt = Math.sin(this.phase * 0.45) * 0.07;
      }
    }
    const eating = now < this.eatUntil;
    if (eating) {
      this.chew += dt * 9;
      set(this.armR, -2.45 + Math.sin(this.chew) * 0.1, 0.42);
      tilt = Math.sin(this.chew) * 0.05;
    } else if (this.held && pose !== "cheer" && pose !== "jump" && pose !== "throw") {
      // carry it in front of the chest
      const swing = pose === "walk" || pose === "run" ? Math.sin(this.phase) * 0.12 : 0;
      set(this.armR, -0.95 + swing, -0.12);
    }
    if (this.held) {
      this.held.userData.tick?.(now);
      this.held.rotation.x = -this.armR.rotation.x;
      this.held.rotation.z = -this.armR.rotation.z;
    }
    if (this.puffs.length) {
      this.puffs = this.puffs.filter((p) => {
        const age = (now - p.t) / 1000;
        if (age > 1.1) {
          this.group.remove(p.s);
          disposeLabel(p.s);
          return false;
        }
        p.s.position.y = 2.35 + age * 0.6;
        p.s.material.opacity = Math.min(1, (1.1 - age) * 3);
        return true;
      });
    }
    if (pose === "sit" || pose === "cheer" || pose === "horse") hipY = HIP;
    this.hips.position.y = hipY;
    this.hips.rotation.x += (lean - this.hips.rotation.x) * k;
    this.head.rotation.z += (tilt - this.head.rotation.z) * k;

    // ^ ^ eyes when excited, otherwise blink every few seconds
    const happy = pose === "cheer" || pose === "jump" || pose === "wave" || eating;
    if (!this.nextBlink) this.nextBlink = now + 1500 + Math.random() * 3000;
    if (now > this.nextBlink + 130) this.nextBlink = now + 2200 + Math.random() * 3500;
    const blinking = now > this.nextBlink;
    for (const e of this.eyes) {
      e.visible = !happy;
      e.scale.y = blinking ? 0.12 : 1;
    }
    for (const e of this.happyEyes) e.visible = happy;
  }

  dispose() {
    this.setHeld(null);
    for (const p of this.puffs) disposeLabel(p.s);
    this.group.removeFromParent();
    disposeLabel(this.label);
    if (this.bubble) disposeLabel(this.bubble);
    this.mats.forEach((m) => m.dispose());
    this.geos.forEach((g) => g.dispose());
  }
}
