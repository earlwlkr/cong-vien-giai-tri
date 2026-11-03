// Character maker: name + look picker with a live 3D preview (first join and "edit character").
import * as THREE from "three";
import { Avatar } from "./avatar";
import { pixelSprite } from "./pixel";
import { HAIR_COLORS, HAIR_STYLES, HAIR_STYLE_NAMES, Look, SHIRT_COLORS, SHOE_COLORS, SKIN_TONES, cleanLook, randomLook } from "../convex/looks";

const $ = (id: string) => document.getElementById(id)!;

export interface Character {
  name: string;
  color: string;
  look: Look;
}

export class CharacterMaker {
  private look: Look = randomLook();
  private color = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  private nameInput = $("nameInput") as HTMLInputElement;
  private canvas = $("lookPreview") as HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.8, 0.1, 20);
  private avatar: Avatar | null = null;
  private running = false;
  private spin = 0.5;
  private drag: { x: number; spin: number } | null = null;
  private lastT = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a9bb8", 1.6));
    const key = new THREE.DirectionalLight("#fff1d6", 2.2);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    this.camera.position.set(0, 1.0, 4.1);
    this.camera.lookAt(0, 0.82, 0);

    this.swatches("colors", SHIRT_COLORS, () => this.color, (c) => (this.color = c));
    this.swatches("optSkin", SKIN_TONES, () => SKIN_TONES[this.look.skin], (_, i) => (this.look.skin = i));
    this.swatches("optHair", HAIR_COLORS, () => HAIR_COLORS[this.look.hair], (_, i) => (this.look.hair = i));
    this.swatches("optShoes", SHOE_COLORS, () => SHOE_COLORS[this.look.shoes], (_, i) => (this.look.shoes = i));
    const chips = $("optStyle");
    for (const st of HAIR_STYLES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.v = st;
      b.textContent = HAIR_STYLE_NAMES[st];
      b.onclick = () => {
        this.look.style = st;
        this.refresh();
      };
      chips.appendChild(b);
    }
    $("randomBtn").addEventListener("click", () => {
      this.look = randomLook();
      this.color = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
      this.refresh();
    });

    // drag the preview to turn the character around
    this.canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, spin: this.spin };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.drag) this.spin = this.drag.spin + (e.clientX - this.drag.x) * 0.02;
    });
    const end = () => (this.drag = null);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
  }

  private swatches(id: string, colors: string[], get: () => string, set: (c: string, i: number) => void) {
    const el = $(id);
    colors.forEach((c, i) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "sw";
      sw.style.background = c;
      sw.dataset.v = c;
      sw.onclick = () => {
        set(c, i);
        this.refresh();
      };
      el.appendChild(sw);
    });
    el.dataset.get = id;
    this.getters.set(el, get);
  }
  private getters = new Map<HTMLElement, () => string>();

  /** Fills the form (keeps the current random look for fields that are missing). */
  set(c: Partial<Character>) {
    if (c.name !== undefined) this.nameInput.value = c.name;
    if (c.color && SHIRT_COLORS.includes(c.color)) this.color = c.color;
    else if (c.color && /^#[0-9a-fA-F]{6}$/.test(c.color)) this.color = c.color;
    if (c.look) this.look = cleanLook(c.look);
    this.refresh();
  }

  value(): Character {
    return { name: this.nameInput.value.trim().slice(0, 18), color: this.color, look: { ...this.look } };
  }

  private refresh() {
    for (const [el, get] of this.getters) {
      const v = get();
      el.querySelectorAll<HTMLElement>(".sw").forEach((s) => s.classList.toggle("sel", s.dataset.v === v));
    }
    $("optStyle").querySelectorAll<HTMLElement>(".chip").forEach((b) => b.classList.toggle("sel", b.dataset.v === this.look.style));
    this.rebuild();
  }

  private rebuild() {
    this.avatar?.dispose();
    this.avatar = new Avatar("", this.color, this.look);
    this.avatar.label.visible = false;
    this.avatar.group.position.y = -0.02;
    this.scene.add(this.avatar.group);
    const px = pixelSprite(this.color, this.look);
    const img = $("pixPreview") as HTMLImageElement;
    img.classList.toggle("hidden", !px);
    if (px) img.src = px.url;
  }

  /** Starts / stops the preview render loop (only runs while the maker is on screen). */
  setActive(on: boolean) {
    if (on === this.running) return;
    this.running = on;
    if (!on) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      } catch {
        this.canvas.classList.add("hidden");
        return;
      }
    }
    if (!this.avatar) this.rebuild();
    this.lastT = 0;
    const loop = (t: number) => {
      if (!this.running || !this.renderer || !this.avatar) return;
      // rAF timestamps can predate performance.now(); a negative dt would make the pose damping explode
      const dt = this.lastT ? Math.max(0, Math.min(0.05, (t - this.lastT) / 1000)) : 0;
      this.lastT = t;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (!this.drag) this.spin += Math.sin(t / 1400) * 0.004;
      this.avatar.group.rotation.y = this.spin;
      this.avatar.animate("idle", 1, dt, t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
