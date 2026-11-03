// Pixel-art sprites baked from the 3D avatars (player list, chat, minimap, character maker).
// Each look is rendered once at sprite resolution with 3-step toon shading, then given a
// dark outline tinted by the colour it touches, so every customisation gets a matching sprite.
import * as THREE from "three";
import { Avatar } from "./avatar";
import { Look, lookKey } from "../convex/looks";

const W = 32;
const H = 40;
const BUST = 22;

export interface PixelSprite {
  /** Full body, W x H. */
  full: HTMLCanvasElement;
  /** Head and shoulders, BUST x BUST. */
  bust: HTMLCanvasElement;
  url: string;
  bustUrl: string;
}

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const scene = new THREE.Scene();
// slightly from above and a little turned, like a top-down RPG sprite
const cam = new THREE.OrthographicCamera(-0.88, 0.88, 1.1, -1.1, 0.1, 30);
cam.position.set(0, 2.2, 8);
cam.lookAt(0, 1.0, 0);
scene.add(new THREE.AmbientLight("#ffffff", 1.35));
const sun = new THREE.DirectionalLight("#fff4e0", 2.4);
sun.position.set(-3, 4, 5);
scene.add(sun);

const ramp = new THREE.DataTexture(new Uint8Array([90, 175, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

function getRenderer() {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    failed = true;
  }
  return renderer;
}

function outline(g: CanvasRenderingContext2D, w: number, h: number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const on = d[i * 4 + 3] > 128;
    solid[i] = on ? 1 : 0;
    d[i * 4 + 3] = on ? 255 : 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || !solid[Y * w + X]) continue;
        const o = (Y * w + X) * 4;
        r += d[o];
        gg += d[o + 1];
        b += d[o + 2];
        n++;
      }
      if (!n) continue;
      // a dark, slightly blue-shifted version of what it touches
      const o = i * 4;
      d[o] = Math.round((r / n) * 0.28 + 10);
      d[o + 1] = Math.round((gg / n) * 0.26 + 8);
      d[o + 2] = Math.round((b / n) * 0.3 + 22);
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function bake(color: string, look: Look): PixelSprite | null {
  const r = getRenderer();
  if (!r) return null;
  const av = new Avatar("", color, look);
  av.label.visible = false;
  for (let i = 0; i < 4; i++) av.animate("idle", 0, 0.3, 0);
  av.group.rotation.y = 0.16;
  // swap the soft materials for toon ones: 3 flat shades per colour, like hand-made pixel art
  const toon: THREE.Material[] = [];
  const restore: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  av.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.material instanceof THREE.MeshStandardMaterial)) return;
    const t = new THREE.MeshToonMaterial({ color: m.material.color, gradientMap: ramp, side: m.material.side });
    toon.push(t);
    restore.push([m, m.material]);
    m.material = t;
  });
  scene.add(av.group);
  r.render(scene, cam);
  scene.remove(av.group);
  for (const [m, mat] of restore) m.material = mat;
  toon.forEach((t) => t.dispose());
  av.dispose();

  const full = document.createElement("canvas");
  full.width = W;
  full.height = H;
  const g = full.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(r.domElement, 0, 0);
  outline(g, W, H);

  // bust: square crop from the top of the head, centred on the head
  const d = g.getImageData(0, 0, W, H).data;
  let top = 0;
  find: for (; top < H; top++) for (let x = 0; x < W; x++) if (d[(top * W + x) * 4 + 3]) break find;
  let sx = 0, n = 0;
  for (let y = top; y < Math.min(H, top + 14); y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3]) {
        sx += x;
        n++;
      }
  const cx = n ? Math.round(sx / n) : W / 2;
  const bust = document.createElement("canvas");
  bust.width = bust.height = BUST;
  bust.getContext("2d")!.drawImage(full, Math.round(cx - BUST / 2), top, BUST, BUST, 0, 0, BUST, BUST);
  return { full, bust, url: full.toDataURL(), bustUrl: bust.toDataURL() };
}

const cache = new Map<string, PixelSprite | null>();

/** Pixel sprite for a look (cached); null if WebGL isn't available. */
export function pixelSprite(color: string, look: Look): PixelSprite | null {
  const key = color + "|" + lookKey(look);
  if (!cache.has(key)) {
    if (cache.size > 300) cache.clear();
    cache.set(key, bake(color, look));
  }
  return cache.get(key)!;
}

/** <img> of a sprite at an integer scale (nearest-neighbour). */
export function pixelImg(s: PixelSprite, kind: "full" | "bust", scale: number, cls = "pix") {
  const img = document.createElement("img");
  img.className = cls;
  img.alt = "";
  img.draggable = false;
  img.src = kind === "full" ? s.url : s.bustUrl;
  img.width = (kind === "full" ? W : BUST) * scale;
  img.height = (kind === "full" ? H : BUST) * scale;
  return img;
}
