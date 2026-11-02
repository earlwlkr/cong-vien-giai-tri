import * as THREE from "three";

export const isTouch =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function damp(a: number, b: number, lambda: number, dt: number) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a: number, b: number, lambda: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Builds a camera-facing label. Height is world-units tall. */
export function makeLabel(
  text: string,
  opts: { color?: string; bg?: string; height?: number; font?: number; maxWidth?: number; tail?: boolean } = {},
) {
  const font = opts.font ?? 44;
  const pad = font * 0.45;
  const maxW = opts.maxWidth ?? 900;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `700 ${font}px system-ui, sans-serif`;
  // word wrap
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (probe.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] += "…";
  const tw = Math.min(maxW, Math.max(...shown.map((l) => probe.measureText(l).width)));
  const lh = font * 1.2;
  const tailH = opts.tail ? font * 0.5 : 0;
  const W = Math.ceil(tw + pad * 2);
  const H = Math.ceil(lh * shown.length + pad * 1.2 + tailH);
  const tex = canvasTexture(W, H, (g) => {
    g.font = `700 ${font}px system-ui, sans-serif`;
    g.fillStyle = opts.bg ?? "rgba(20,30,60,0.6)";
    roundRect(g, 0, 0, W, H - tailH, Math.min(font * 0.6, (H - tailH) / 2));
    g.fill();
    if (opts.tail) {
      g.beginPath();
      g.moveTo(W / 2 - tailH, H - tailH - 1);
      g.lineTo(W / 2, H);
      g.lineTo(W / 2 + tailH, H - tailH - 1);
      g.fill();
    }
    g.fillStyle = opts.color ?? "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    shown.forEach((l, i) => g.fillText(l, W / 2, pad * 0.6 + lh * (i + 0.5), maxW));
  });
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const h = (opts.height ?? 0.35) * (H / (font * 1.2 + pad * 1.2));
  s.scale.set((h * W) / H, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

export function disposeLabel(s: THREE.Sprite) {
  s.material.map?.dispose();
  s.material.dispose();
}

/** Flat sign board with text. */
export function makeSign(text: string, w: number, h: number, bg = "#ff4e7a", fg = "#fff", sub?: string) {
  const px = 128;
  const tex = canvasTexture(Math.round(w * px), Math.round(h * px), (g) => {
    const W = g.canvas.width, H = g.canvas.height;
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, bg);
    grd.addColorStop(1, shade(bg, -30));
    g.fillStyle = grd;
    roundRect(g, 0, 0, W, H, H * 0.18);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.lineWidth = H * 0.05;
    roundRect(g, H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12, H * 0.14);
    g.stroke();
    // bulbs
    g.fillStyle = "#fff6c2";
    const n = Math.floor(W / (H * 0.18));
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * (W / n);
      g.beginPath(); g.arc(x, H * 0.03 + 4, H * 0.025, 0, 7); g.fill();
      g.beginPath(); g.arc(x, H - H * 0.03 - 4, H * 0.025, 0, 7); g.fill();
    }
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let fs = H * (sub ? 0.36 : 0.48);
    g.font = `900 ${fs}px system-ui, sans-serif`;
    while (g.measureText(text).width > W * 0.88 && fs > 10) {
      fs *= 0.92;
      g.font = `900 ${fs}px system-ui, sans-serif`;
    }
    g.shadowColor = "rgba(0,0,0,.35)";
    g.shadowBlur = H * 0.04;
    g.fillText(text, W / 2, sub ? H * 0.4 : H / 2);
    if (sub) {
      g.font = `700 ${H * 0.17}px system-ui, sans-serif`;
      g.fillText(sub, W / 2, H * 0.73, W * 0.9);
    }
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  return m;
}

export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt / 100)));
  return "#" + c.getHexString();
}

export function std(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra });
}

export function shadowy<T extends THREE.Object3D>(o: T, cast = true, receive = true) {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
}
export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
