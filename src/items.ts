import * as THREE from "three";
import { getItem } from "../convex/catalog";
import { canvasTexture } from "./util";

// Hand-held food, drinks and balloons. Geometry and materials are shared and never disposed.
const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g as T;
};
const matCache = new Map<string, THREE.Material>();
const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, key = "") => {
  const k = color + key;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.12, ...extra })));
  return m;
};
const glass = () => mat("#e8f6ff", { transparent: true, opacity: 0.35, roughness: 0.1, emissiveIntensity: 0, depthWrite: false }, "glass");

let stripeTex: THREE.Texture | null = null;
const stripes = () =>
  (stripeTex ??= canvasTexture(64, 16, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#ffffff" : "#e63946";
      g.fillRect(i * 8, 0, 8, 16);
    }
  }));
let waffleTex: THREE.Texture | null = null;
const waffle = () =>
  (waffleTex ??= canvasTexture(64, 64, (g) => {
    g.fillStyle = "#d9a35a";
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = "#a8722f";
    g.lineWidth = 3;
    for (let i = -64; i < 128; i += 12) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
      g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
    }
  }));

const m = (g: THREE.BufferGeometry, mt: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, mt);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};

/** Model of `id` with `left` of its bites remaining. Origin = where the hand grips it. */
export function makeItem(id: string, left?: number): THREE.Group {
  const it = getItem(id);
  const root = new THREE.Group();
  if (!it) return root;
  const f = Math.max(0, Math.min(1, (left ?? it.bites) / it.bites));
  const sphere = geo("sphere", () => new THREE.SphereGeometry(1, 14, 10));
  const c = it.colors;
  switch (it.model) {
    case "cone": {
      const cone = m(geo("cone", () => new THREE.ConeGeometry(0.075, 0.22, 14, 1, true)), mat("#d9a35a", { map: waffle(), side: THREE.DoubleSide, emissiveIntensity: 0.05 }, "waffle"), 0, 0.02, 0);
      cone.rotation.x = Math.PI;
      root.add(cone);
      const scoops = new THREE.Group();
      scoops.position.y = 0.14;
      c.forEach((col, i) => {
        const s = m(sphere, mat(col), 0, i * 0.1, 0);
        s.scale.setScalar(0.085);
        scoops.add(s);
      });
      // drips
      const drip = m(sphere, mat(c[0]), 0.05, -0.03, 0.05);
      drip.scale.set(0.022, 0.04, 0.022);
      scoops.add(drip);
      const total = c.length;
      const shown = f * total;
      scoops.children.forEach((s, i) => {
        if (i >= total) return;
        const k = Math.max(0, Math.min(1, shown - i));
        s.visible = k > 0.05;
        s.scale.setScalar(0.085 * (0.45 + 0.55 * k));
      });
      if (f <= 0.25) cone.scale.y = 0.7;
      root.add(scoops);
      break;
    }
    case "popcorn": {
      const bucket = m(geo("bucket", () => new THREE.CylinderGeometry(0.12, 0.085, 0.22, 16, 1, true)), mat("#ffffff", { map: stripes(), side: THREE.DoubleSide, emissiveIntensity: 0.05 }, "stripes"), 0, 0.06, 0);
      root.add(bucket);
      const bottom = m(geo("bucketB", () => new THREE.CircleGeometry(0.085, 16)), mat("#ffffff"), 0, -0.05, 0);
      bottom.rotation.x = -Math.PI / 2;
      root.add(bottom);
      const kernel = geo("kernel", () => new THREE.IcosahedronGeometry(0.03, 0));
      const n = Math.round(4 + 22 * f);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4, r = 0.03 + ((i * 37) % 9) / 100;
        const k = m(kernel, mat(i % 5 === 0 ? c[1] : c[0]), Math.cos(a) * r, 0.1 + 0.07 * f + ((i * 13) % 7) / 180, Math.sin(a) * r);
        k.rotation.set(i, i * 2, 0);
        root.add(k);
      }
      break;
    }
    case "cup": {
      const cup = m(geo("cup", () => new THREE.CylinderGeometry(0.075, 0.055, 0.22, 16, 1, true)), glass(), 0, 0.06, 0);
      cup.castShadow = false;
      const h = 0.19 * Math.max(0.04, f);
      const liquid = m(geo("liquid", () => new THREE.CylinderGeometry(0.068, 0.056, 1, 14)), mat(c[0], { transparent: true, opacity: 0.85 }, "juice"), 0, -0.045 + h / 2, 0);
      liquid.scale.y = h;
      root.add(liquid, cup);
      if (f > 0.3) {
        const ice = geo("ice", () => new THREE.BoxGeometry(0.04, 0.04, 0.04));
        for (let i = 0; i < 3; i++) {
          const cube = m(ice, mat("#f4fbff", { transparent: true, opacity: 0.7 }, "ice"), (i - 1) * 0.03, -0.045 + h - 0.015, ((i * 7) % 3 - 1) * 0.02);
          cube.rotation.set(i, i * 0.7, 0);
          root.add(cube);
        }
      }
      const lid = m(geo("lid", () => new THREE.SphereGeometry(0.077, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2)), glass(), 0, 0.17, 0);
      lid.scale.y = 0.4;
      const straw = m(geo("straw", () => new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6)), mat("#ff4e7a"), 0.02, 0.2, 0);
      straw.rotation.z = -0.25;
      root.add(lid, straw);
      break;
    }
    case "coconut": {
      const nut = m(sphere, mat(c[0], { roughness: 0.8 }), 0, 0.09, 0);
      nut.scale.set(0.13, 0.14, 0.13);
      const top = m(geo("cocoTop", () => new THREE.CircleGeometry(0.06, 14)), mat("#fff8e6"), 0, 0.225, 0);
      top.rotation.x = -Math.PI / 2;
      const straw = m(geo("straw", () => new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6)), mat("#3a86ff"), 0.02, 0.3, 0);
      straw.rotation.z = -0.3;
      // tiny paper umbrella
      const umb = m(geo("umb", () => new THREE.ConeGeometry(0.07, 0.04, 8, 1, true)), mat("#ffd166", { side: THREE.DoubleSide }, "umb"), -0.04, 0.37, 0);
      const stick = m(geo("umbStick", () => new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4)), mat("#ffffff"), -0.04, 0.29, 0);
      root.add(nut, top, straw, umb, stick);
      root.scale.setScalar(0.85 + 0.15 * f);
      break;
    }
    case "banhmi": {
      const len = 0.36 * (0.3 + 0.7 * f);
      const bread = new THREE.Group();
      const loaf = m(geo("loaf", () => new THREE.CapsuleGeometry(0.055, 1, 6, 12)), mat("#e3a04f", { roughness: 0.75 }, "loaf"));
      loaf.scale.set(1, len / 1.11, 1);
      loaf.rotation.x = Math.PI / 2;
      const fill = m(geo("fill", () => new THREE.BoxGeometry(0.05, 0.03, 1)), mat(c[0]), 0, 0.045, 0);
      fill.scale.z = len * 0.85;
      const herb = m(geo("herb", () => new THREE.BoxGeometry(0.06, 0.02, 1)), mat("#4caf50"), 0, 0.06, 0);
      herb.scale.z = len * 0.6;
      bread.add(loaf, fill, herb);
      // held near the back end; bites come off the front
      bread.position.set(0, 0.04, len / 2 - 0.05);
      bread.rotation.x = -0.5;
      root.add(bread);
      break;
    }
    case "cotton": {
      const stick = m(geo("ccStick", () => new THREE.CylinderGeometry(0.008, 0.008, 0.32, 5)), mat("#f4ead2"), 0, 0.1, 0);
      root.add(stick);
      const fluff = new THREE.Group();
      fluff.position.y = 0.3;
      const blobs = [[0, 0, 0, 0.13], [0.07, 0.05, 0.03, 0.09], [-0.07, 0.04, -0.02, 0.09], [0.02, 0.1, -0.05, 0.08], [-0.02, -0.06, 0.06, 0.08], [0.05, -0.04, -0.06, 0.07]];
      blobs.forEach(([x, y, z, r], i) => {
        const b = m(sphere, mat(c[i % c.length], { roughness: 1, emissiveIntensity: 0.3 }, "fluff"), x, y, z);
        b.scale.setScalar(r);
        fluff.add(b);
      });
      fluff.scale.setScalar(0.35 + 0.65 * f);
      fluff.position.y = 0.2 + 0.1 * (0.35 + 0.65 * f);
      root.add(fluff);
      break;
    }
    case "balloon": {
      const H = 1.05;
      const string = m(geo("string", () => new THREE.CylinderGeometry(0.004, 0.004, 1, 4)), mat("#ffffff"), 0, H / 2, 0);
      string.scale.y = H;
      string.castShadow = false;
      const ball = new THREE.Group();
      ball.position.y = H + 0.24;
      const b = m(sphere, mat(c[0], { roughness: 0.25, metalness: 0.1, emissiveIntensity: 0.18 }), 0, 0, 0);
      b.scale.set(0.24, 0.28, 0.24);
      const shine = m(sphere, mat("#ffffff", { transparent: true, opacity: 0.55, emissiveIntensity: 0.6 }, "shine"), -0.08, 0.1, 0.17);
      shine.scale.set(0.05, 0.07, 0.03);
      const knot = m(geo("knot", () => new THREE.ConeGeometry(0.03, 0.05, 6)), mat(c[0]), 0, -0.29, 0);
      ball.add(b, shine, knot);
      root.add(string, ball);
      const seed = Math.random() * 10;
      root.userData.tick = (now: number) => {
        const t = now / 1000 + seed;
        ball.position.x = Math.sin(t * 1.3) * 0.05;
        ball.position.z = Math.cos(t * 1.1) * 0.04;
        ball.rotation.z = Math.sin(t * 1.3) * 0.12;
      };
      root.userData.balloon = c[0];
      break;
    }
  }
  return root;
}
