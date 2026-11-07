import * as THREE from "three";
import { makeLabel, disposeLabel, shade, std } from "./util";
import { spriteCanvas, type SpriteName } from "./sprites";
import { HAIR_COLORS, Look, SHOE_COLORS, SKIN_TONES, cleanLook } from "../convex/looks";

export type Pose = "idle" | "walk" | "run" | "jump" | "sit" | "bench" | "cheer" | "horse" | "throw" | "wave" | "serve";

// Low-poly chibi proportions: short legs, faceted body, big head.
const SCALE = 0.95;
const HIP = 0.51; // unscaled hip height above the feet
const NECK = 0.6; // head pivot above the hips
const HEAD_R = 0.4;
const HEAD_CY = 0.36; // head centre above the neck pivot
export const HIP_HEIGHT = HIP * SCALE;
export const EYE_OFFSET = (NECK + HEAD_CY - 0.03) * SCALE; // from hip to eyes
export const EYE_HEIGHT = HIP_HEIGHT + EYE_OFFSET;

/** Reaction sprite textures, shared by every avatar (never disposed). */
const reactTex = new Map<SpriteName, THREE.Texture>();
function reactionTexture(name: SpriteName) {
  let t = reactTex.get(name);
  if (!t) {
    t = new THREE.CanvasTexture(spriteCanvas(name, 4));
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    reactTex.set(name, t);
  }
  return t;
}
const REACT_LIFE = 2.2; // seconds a reaction floats

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
  private waveUntil = 0;
  private wavePhase = 0;
  private chew = 0;
  private puffs: { s: THREE.Sprite; t: number }[] = [];
  private reacts: { s: THREE.Sprite; t: number; x: number; ph: number }[] = [];

  readonly look: Look;

  constructor(public name: string, public color: string, look: Look) {
    this.look = cleanLook(look);
    const { style } = this.look;
    // Low-poly look: faceted shapes with flat shading, to match the park's trees.
    // A touch of self-glow keeps the toy-like colours bright on the shadowed side.
    const soft = (c: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = std(c, { roughness: 0.85, flatShading: true, emissive: c, emissiveIntensity: 0.14, ...extra });
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
    const trim = soft(shade(color, 20));
    const pants = soft(shade(color, -32));
    const belt = soft(shade(color, -44));
    const skin = soft(SKIN_TONES[this.look.skin], { roughness: 0.7, emissiveIntensity: 0.2 });
    const shoe = soft(SHOE_COLORS[this.look.shoes]);
    const sole = soft(this.look.shoes === 0 ? "#9aa3b5" : "#f4f4f4");
    const hair = soft(HAIR_COLORS[this.look.hair]);
    const ink = flat("#2a1f2d");
    const white = flat("#ffffff");
    const blush = flat("#ff8fa3", 0.6);
    const earPink = soft("#ffb3c6");

    const box = g(new THREE.BoxGeometry(1, 1, 1));
    const gem = g(new THREE.IcosahedronGeometry(1, 0));
    const chunk = g(new THREE.DodecahedronGeometry(1, 0));
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      return m;
    };
    /** 8-sided prism turned so the front and back are flat panels. */
    const prism = (rTop: number, rBot: number, h: number, mat: THREE.Material, y: number) => {
      const m = mesh(g(new THREE.CylinderGeometry(rTop, rBot, h, 8)), mat, 0, y);
      m.rotation.y = Math.PI / 8;
      return m;
    };

    this.group.add(this.hips);
    this.hips.position.y = HIP;

    // legs: tapered prisms with blocky sneakers
    const legGeo = g(new THREE.CylinderGeometry(0.1, 0.085, 0.36, 6));
    for (const [leg, x] of [[this.legL, 0.11], [this.legR, -0.11]] as const) {
      leg.position.set(x, 0, 0);
      leg.add(mesh(legGeo, pants, 0, -0.2, 0));
      leg.add(mesh(box, shoe, 0, -0.435, 0.04, 0.19, 0.1, 0.27));
      leg.add(mesh(box, sole, 0, -0.4925, 0.04, 0.2, 0.035, 0.28));
      this.hips.add(leg);
    }

    // faceted torso: belt, shirt, collar
    this.hips.add(prism(0.262, 0.262, 0.08, belt, 0.06));
    this.hips.add(prism(0.2, 0.255, 0.46, shirt, 0.31));
    this.hips.add(prism(0.13, 0.17, 0.05, trim, 0.545));

    // arms: short sleeve, forearm, faceted fist
    const sleeveGeo = g(new THREE.CylinderGeometry(0.08, 0.072, 0.17, 5));
    const foreGeo = g(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 5));
    for (const [arm, x] of [[this.armL, 0.28], [this.armR, -0.28]] as const) {
      arm.position.set(x, 0.45, 0);
      arm.add(mesh(sleeveGeo, shirt, 0, -0.07, 0));
      arm.add(mesh(foreGeo, skin, 0, -0.2, 0));
      arm.add(mesh(gem, skin, 0, -0.29, 0, 0.072));
      this.hips.add(arm);
    }
    this.hips.add(mesh(g(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 6)), skin, 0, 0.57, 0));

    // big gem-cut head
    this.head.position.y = NECK;
    const C = new THREE.Vector3(0, HEAD_CY, 0);
    this.head.add(mesh(g(new THREE.IcosahedronGeometry(HEAD_R, 1)), skin, 0, HEAD_CY, 0, 1.05, 0.97, 1));
    /** Point on the head surface in direction (x, y, z), pushed out by `out`. */
    const onHead = (x: number, y: number, z: number, out = 0) =>
      new THREE.Vector3(x, y, z).normalize().multiplyScalar(HEAD_R + out).add(C);
    const facing = (m: THREE.Object3D, dir: THREE.Vector3) => {
      m.lookAt(dir.clone().sub(C).multiplyScalar(10).add(C));
      return m;
    };
    const stuck = (geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, sx: number, sy = sx, sz = sx) =>
      facing(mesh(geo, mat, at.x, at.y, at.z, sx, sy, sz), at);

    // face: tall block eyes with a glint, ^ ^ when happy, square cheeks, angular smile
    for (const side of [1, -1]) {
      const at = onHead(side * 0.34, -0.06, 0.94, -0.012);
      const eye = new THREE.Group();
      eye.position.copy(at);
      facing(eye, at);
      eye.add(mesh(box, ink, 0, 0, 0, 0.075, 0.11, 0.03));
      eye.add(mesh(box, white, side * 0.014, 0.025, 0.016, 0.028, 0.032, 0.01));
      this.head.add(eye);
      this.eyes.push(eye);

      const happy = new THREE.Group();
      happy.position.copy(at);
      facing(happy, at);
      for (const s of [1, -1]) {
        const stroke = mesh(box, ink, s * 0.022, 0, 0.005, 0.06, 0.02, 0.02);
        stroke.rotation.z = -s * 0.6;
        happy.add(stroke);
      }
      happy.visible = false;
      this.head.add(happy);
      this.happyEyes.push(happy);

      this.head.add(stuck(box, blush, onHead(side * 0.6, -0.33, 0.73, -0.005), 0.09, 0.045, 0.02));
      if (style !== "catHood" && style !== "bearHood") {
        // little ears
        this.head.add(mesh(gem, skin, side * 0.41, HEAD_CY - 0.04, 0, 0.055, 0.08, 0.06));
      }
    }
    const smile = stuck(g(new THREE.TorusGeometry(0.04, 0.013, 3, 4, Math.PI)), ink, onHead(0, -0.36, 0.93, -0.004), 1);
    smile.rotateZ(Math.PI);
    this.head.add(smile);

    // hair / hoods: a faceted shell plus polygon chunks
    const shell = (mat: THREE.Material, coverage: number, tilt: number, r = HEAD_R + 0.035) => {
      const m = mesh(g(new THREE.SphereGeometry(r, 9, 5, 0, Math.PI * 2, 0, Math.PI * coverage)), mat, 0, HEAD_CY, 0);
      m.scale.x = 1.05;
      m.rotation.x = tilt;
      return m;
    };
    /** Dodecahedron lump on the head; `spin` varies its facets. */
    const lump = (mat: THREE.Material, dir: [number, number, number], r: number, out = 0, spin = 0) => {
      const m = mesh(chunk, mat, 0, 0, 0, r);
      m.position.copy(onHead(...dir, out));
      m.rotation.set(dir[0] * 3 + spin, dir[1] * 2 + spin, dir[2] * 4);
      return m;
    };
    const top = HEAD_CY + HEAD_R;
    if (style === "catHood" || style === "bearHood") {
      const hood = soft(shade(color, -8));
      this.head.add(shell(hood, 0.56, -0.55, HEAD_R + 0.05));
      // a bit of fringe peeking out under the hood
      for (const x of [-0.17, 0, 0.17]) this.head.add(lump(hair, [x, 0.36, 0.9], 0.07, -0.03, x * 5));
      for (const side of [1, -1]) {
        if (style === "catHood") {
          const ear = mesh(g(new THREE.ConeGeometry(0.13, 0.24, 4)), hood, side * 0.25, top + 0.06, -0.04);
          ear.rotation.set(0, Math.PI / 4, -side * 0.42);
          const inner = mesh(g(new THREE.ConeGeometry(0.07, 0.14, 4)), earPink, side * 0.245, top + 0.04, 0.03);
          inner.rotation.set(0, Math.PI / 4, -side * 0.42);
          this.head.add(ear, inner);
        } else {
          this.head.add(mesh(chunk, hood, side * 0.28, top - 0.05, -0.06, 0.12, 0.12, 0.075));
          this.head.add(mesh(chunk, earPink, side * 0.28, top - 0.06, 0.0, 0.068, 0.068, 0.03));
        }
      }
    } else {
      this.head.add(shell(hair, 0.5, -0.32));
      // chunky fringe across the forehead
      for (const x of [-0.24, -0.08, 0.08, 0.24]) this.head.add(lump(hair, [x, 0.5, 0.8], 0.105, 0.0, x * 7));
      if (style === "tuft") {
        // curly: polygon chunks all over the crown and back
        const curls: [number, number, number, number][] = [
          [0.45, 0.75, 0.3, 0.15], [-0.45, 0.75, 0.3, 0.15], [0, 1, 0.1, 0.17], [0.4, 0.8, -0.3, 0.16], [-0.4, 0.8, -0.3, 0.16],
          [0, 0.6, -0.75, 0.17], [0.55, 0.3, -0.7, 0.14], [-0.55, 0.3, -0.7, 0.14], [0, 0.1, -1, 0.15], [0.75, 0.35, 0, 0.13], [-0.75, 0.35, 0, 0.13],
        ];
        for (const [x, y, z, r] of curls) this.head.add(lump(hair, [x, y, z], r, -0.02));
      } else if (style === "buns") {
        for (const side of [1, -1]) this.head.add(mesh(chunk, hair, side * 0.3, top - 0.05, -0.08, 0.14));
        this.head.add(lump(hair, [0, 0.2, -1], 0.13, -0.03));
      } else {
        // long hair down the back with a bow
        for (const [x, y, r] of [[0, -0.1, 0.16], [0.28, -0.05, 0.14], [-0.28, -0.05, 0.14], [0.16, -0.4, 0.13], [-0.16, -0.4, 0.13]] as const)
          this.head.add(lump(hair, [x, y, -0.95], r, -0.04));
        const bowMat = soft(this.look.hair === 6 ? shade(color, 18) : "#ff7eb6");
        const bow = new THREE.Group();
        bow.position.set(0.24, top - 0.06, 0.12);
        bow.rotation.z = -0.5;
        for (const s of [1, -1]) {
          const loop = mesh(g(new THREE.ConeGeometry(0.08, 0.15, 4)), bowMat, s * 0.07, 0, 0);
          loop.rotation.z = (s * Math.PI) / 2;
          bow.add(loop);
        }
        bow.add(mesh(gem, bowMat, 0, 0, 0, 0.045));
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
      const hat = m(new THREE.ConeGeometry(0.62, 0.36, 10, 1, true), std("#e8d29a", { side: THREE.DoubleSide, roughness: 0.9, flatShading: true }));
      hat.position.y = top + 0.02;
      const band = m(new THREE.TorusGeometry(0.36, 0.018, 4, 10), std("#c0392b"));
      band.rotation.x = Math.PI / 2;
      band.position.y = top - 0.06;
      this.head.add(hat, band);
    } else if (kind === "chef") {
      const white = std("#ffffff", { roughness: 0.9, flatShading: true, emissive: "#ffffff", emissiveIntensity: 0.15 });
      const base = m(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8), white);
      base.position.y = top - 0.02;
      const puff = m(new THREE.IcosahedronGeometry(0.34, 1), white);
      puff.scale.y = 0.7;
      puff.position.y = top + 0.18;
      this.head.add(base, puff);
    } else {
      const capMat = std(color, { roughness: 0.8, flatShading: true });
      const dome = m(new THREE.SphereGeometry(HEAD_R + 0.05, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), capMat);
      dome.position.y = HEAD_CY + 0.02;
      dome.rotation.x = -0.18;
      const brim = m(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 6, 1, false, -Math.PI / 2, Math.PI), capMat);
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

  /** Waves hello with the right hand for a moment; layers on top of any pose (walking, seated...). */
  wave(now: number, ms = 1800) {
    this.waveUntil = now + ms;
  }

  /** Little floating text (e.g. "măm!") that rises and fades. */
  puff(text: string, now: number, color = "#ffffff") {
    const s = makeLabel(text, { bg: "rgba(255,120,80,0.92)", color, height: 0.24, font: 34 });
    s.position.set((Math.random() - 0.5) * 0.4, 2.35, 0);
    this.group.add(s);
    this.puffs.push({ s, t: now });
  }

  /** A reaction sprite (heart, haha...) that pops above the head, sways up and fades. */
  react(name: SpriteName, now: number) {
    if (this.reacts.length >= 6) this.dropReact(this.reacts.shift()!);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: reactionTexture(name), depthWrite: false, transparent: true }));
    s.center.set(0.5, 0);
    s.renderOrder = 11;
    const x = (Math.random() - 0.5) * 0.5;
    s.position.set(x, 2.38, 0);
    s.scale.setScalar(0.01);
    this.group.add(s);
    this.reacts.push({ s, t: now, x, ph: Math.random() * 6 });
  }
  /** Reactions floating right now (tests). */
  get reacting() {
    return this.reacts.length;
  }
  private dropReact(r: { s: THREE.Sprite }) {
    this.group.remove(r.s);
    r.s.material.dispose();
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
      case "bench": {
        // feet dangling off the plank, swinging now and then
        this.phase += dt * 2.2;
        const swing = Math.max(0, Math.sin(this.phase * 0.3)) * Math.sin(this.phase * 2.4) * 0.22;
        set(this.legL, -1.25 + swing, 0.1);
        set(this.legR, -1.25 - swing, -0.1);
        set(this.armL, -0.7, 0.12);
        set(this.armR, -0.7, -0.12);
        tilt = Math.sin(this.phase * 0.45) * 0.07;
        break;
      }
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
    const waving = !eating && now < this.waveUntil;
    if (waving) {
      this.wavePhase += dt * 10;
      set(this.armR, -0.2, -2.5 + Math.sin(this.wavePhase) * 0.35);
      tilt = 0.1;
    } else if (eating) {
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
    if (this.reacts.length) {
      // start above the chat bubble if there is one
      const base = this.bubble ? this.bubble.position.y + this.bubble.scale.y + 0.1 : 2.38;
      this.reacts = this.reacts.filter((r) => {
        const age = (now - r.t) / 1000;
        if (age > REACT_LIFE) {
          this.dropReact(r);
          return false;
        }
        // pop in with a little overshoot, then drift up and fade out
        const a = Math.min(1, age / 0.25) - 1;
        const size = 0.62 * Math.max(0.01, 1 + 2.7 * a * a * a + 1.7 * a * a); // ease-out-back
        r.s.scale.set(size, size, 1);
        r.s.position.set(r.x + Math.sin(age * 4 + r.ph) * 0.12, base + age * 0.45, 0);
        r.s.material.opacity = Math.min(1, (REACT_LIFE - age) * 2.5);
        return true;
      });
    }
    if (pose === "sit" || pose === "bench" || pose === "cheer" || pose === "horse") hipY = HIP;
    this.hips.position.y = hipY;
    this.hips.rotation.x += (lean - this.hips.rotation.x) * k;
    this.head.rotation.z += (tilt - this.head.rotation.z) * k;

    // ^ ^ eyes when excited, otherwise blink every few seconds
    const happy = pose === "cheer" || pose === "jump" || pose === "wave" || eating || waving;
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
    for (const r of this.reacts) r.s.material.dispose();
    this.group.removeFromParent();
    disposeLabel(this.label);
    if (this.bubble) disposeLabel(this.bubble);
    this.mats.forEach((m) => m.dispose());
    this.geos.forEach((g) => g.dispose());
  }
}
