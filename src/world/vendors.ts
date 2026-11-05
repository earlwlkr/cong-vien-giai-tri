import * as THREE from "three";
import { CARTS, Cart, CartKind, ITEMS, cartFront } from "../../convex/catalog";
import { lookFromSeed } from "../../convex/looks";
import { Avatar, Pose } from "../avatar";
import { canvasTexture, Collider, makeSign, rng, shade, std } from "../util";
import { drawSprite, isSprite } from "../sprites";
import { makeItem } from "../items";

// Street-food carts (xe đẩy) with a seller behind each counter. Local +z is the customer side.
const COUNTER_Y = 1.05;
/** Seller spot behind the counter (kept clear of tall equipment so they're visible). */
const SELLER = { x: 0.55, z: -0.95 };

interface Vendor {
  cart: Cart;
  group: THREE.Group;
  seller: Avatar;
  pose: Pose;
  poseUntil: number;
  /** Seller's facing in cart-local space. */
  yaw: number;
  near: boolean;
  lastHello: number;
  tick: ((t: number) => void)[];
}

function stripeTex(a: string, b: string, n = 8, w = 256, h = 32) {
  return canvasTexture(w, h, (g) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
  });
}

/** Painted front panel: big title with the cart's sprite, scalloped trim. */
function frontPanel(c: Cart, w: number, h: number) {
  const tex = canvasTexture(512, Math.round((512 * h) / w), (g) => {
    const W = g.canvas.width, H = g.canvas.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, shade(c.color, 8));
    grd.addColorStop(1, shade(c.color, -14));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,.9)";
    for (let x = 0; x < W; x += 32) {
      g.beginPath(); g.arc(x + 16, 0, 14, 0, Math.PI); g.fill();
    }
    g.fillRect(0, H - 8, W, 8);
    const sz = H * 0.55;
    if (isSprite(c.sprite)) {
      drawSprite(g, c.sprite, sz * 0.75, H * 0.56, sz);
      drawSprite(g, c.sprite, W - sz * 0.75, H * 0.56, sz);
    }
    g.fillStyle = "#fff";
    g.strokeStyle = shade(c.color, -35);
    g.lineWidth = 8;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let fs = H * 0.48;
    g.font = `900 ${fs}px system-ui, sans-serif`;
    while (g.measureText(c.title).width > W - sz * 3 && fs > 12) g.font = `900 ${(fs *= 0.92)}px system-ui, sans-serif`;
    g.strokeText(c.title, W / 2, H * 0.56);
    g.fillText(c.title, W / 2, H * 0.56);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
}

/** Chalkboard A-frame listing the menu in Xu. */
function menuBoard(c: Cart) {
  const g = new THREE.Group();
  const items = c.items.map((id) => ITEMS[id]);
  const tex = canvasTexture(320, 400, (x) => {
    x.fillStyle = "#6b4220";
    x.fillRect(0, 0, 320, 400);
    x.fillStyle = "#24302b";
    x.fillRect(14, 14, 292, 372);
    x.fillStyle = "#ffd166";
    x.textAlign = "center";
    x.font = "900 40px system-ui, sans-serif";
    x.fillText("THỰC ĐƠN", 160, 64);
    x.strokeStyle = "rgba(255,255,255,.5)";
    x.setLineDash([6, 6]);
    x.beginPath(); x.moveTo(36, 84); x.lineTo(284, 84); x.stroke();
    items.forEach((it, i) => {
      const y = 130 + i * 78;
      if (isSprite(it.sprite)) drawSprite(x, it.sprite, 48, y - 2, 34);
      x.textAlign = "left";
      x.fillStyle = "#ffffff";
      let fs = 25;
      x.font = `700 ${fs}px system-ui, sans-serif`;
      while (x.measureText(it.name).width > 230 && fs > 12) x.font = `700 ${(fs -= 1)}px system-ui, sans-serif`;
      x.fillText(it.name, 74, y - 8);
      x.fillStyle = "#ffd166";
      x.font = "900 24px system-ui, sans-serif";
      x.fillText(`${it.price} Xu`, 74, y + 22);
    });
  });
  // Two boards hinged at the top, each long enough that its foot rests on the ground.
  const tilt = 0.22, len = 1.5;
  const hingeY = len * Math.cos(tilt);
  const wood = std("#6b4220");
  for (const s of [1, -1]) {
    const side = new THREE.Group();
    side.position.y = hingeY;
    side.rotation.x = -s * tilt;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.82, len, 0.03), wood);
    board.position.y = -len / 2;
    side.add(board);
    if (s === 1) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      face.position.set(0, -0.56, 0.017);
      side.add(face);
    }
    g.add(side);
  }
  return g;
}

function wheel(r: number) {
  const g = new THREE.Group();
  const dark = std("#3b2a20");
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 24), dark);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10), std("#ffd166"));
  hub.rotation.x = Math.PI / 2;
  g.add(rim, hub);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 2, 0.03), std("#c98b4a"));
    s.rotation.z = (i / 6) * Math.PI;
    g.add(s);
  }
  g.rotation.y = Math.PI / 2;
  return g;
}

function umbrella(a: string, b: string) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 8), std("#eeeeee", { metalness: 0.5 }));
  pole.position.y = COUNTER_Y + 0.95;
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(1.75, 0.55, 16, 1, true),
    (() => {
      const tex = stripeTex(a, b, 16);
      // emissive keeps the shaded underside colourful
      return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: "#ffffff", emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.8 });
    })(),
  );
  canopy.position.y = COUNTER_Y + 2.05;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), std(a));
  knob.position.y = COUNTER_Y + 2.35;
  // scalloped fringe
  const fringe = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(b), 16);
  for (let i = 0; i < 16; i++) {
    const t = ((i + 0.5) / 16) * Math.PI * 2;
    fringe.setMatrixAt(i, new THREE.Matrix4().makeTranslation(Math.sin(t) * 1.72, COUNTER_Y + 1.79, Math.cos(t) * 1.72));
    fringe.setColorAt(i, new THREE.Color(i % 2 ? b : a));
  }
  g.add(pole, canopy, knob, fringe);
  g.position.z = -0.35;
  return g;
}

function canopyRoof(c: Cart) {
  const g = new THREE.Group();
  const poleM = std("#ffffff", { metalness: 0.3 });
  for (const x of [-1.1, 1.1]) for (const z of [-0.55, 0.5]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 6), poleM);
    p.position.set(x, COUNTER_Y + 0.67, z);
    g.add(p);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.08, 1.7), new THREE.MeshStandardMaterial({ map: stripeTex(c.color, "#ffffff", 10), roughness: 0.8 }));
  roof.position.set(0, COUNTER_Y + 1.42, 0.05);
  roof.rotation.x = 0.12;
  const val = new THREE.InstancedMesh(new THREE.SphereGeometry(0.135, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std("#ffffff"), 10);
  for (let i = 0; i < 10; i++) {
    val.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-1.215 + i * 0.27, COUNTER_Y + 1.33, 0.9));
    val.setColorAt(i, new THREE.Color(i % 2 ? "#ffffff" : c.color));
  }
  const sign = makeSign(`{${c.sprite}} ${c.title}`, 2.3, 0.55, c.color, "#fff");
  sign.position.set(0, COUNTER_Y + 1.78, 0.75);
  g.add(roof, val, sign);
  return g;
}

/** The per-cart specialty equipment on the counter. */
function props(c: Cart, tick: ((t: number) => void)[]) {
  const g = new THREE.Group();
  g.position.y = COUNTER_Y + 0.04;
  const glassM = new THREE.MeshStandardMaterial({ color: "#dff3ff", transparent: true, opacity: 0.28, roughness: 0.05, depthWrite: false });
  const steel = std("#c7ced8", { metalness: 0.7, roughness: 0.3 });
  const r = rng(c.id.length * 31);
  switch (c.id as CartKind) {
    case "kem": {
      // three freezer tubs showing the flavours, plus a stack of cones
      ["#fff1cf", "#ff9fb2", "#7a4a2a"].forEach((col, i) => {
        const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.14, 18), steel);
        tub.position.set(-0.7 + i * 0.55, 0.07, -0.05);
        const cream = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(col, { emissive: col, emissiveIntensity: 0.15 }));
        cream.scale.y = 0.45;
        cream.position.set(tub.position.x, 0.13, tub.position.z);
        g.add(tub, cream);
      });
      for (let i = 0; i < 4; i++) {
        const cone = makeItem("kem_vani");
        cone.children.forEach((ch, j) => (ch.visible = j === 0));
        cone.position.set(0.95, 0.12 + i * 0.05, 0.15);
        g.add(cone);
      }
      const big = makeItem("kem_dau");
      big.scale.setScalar(4);
      big.position.set(0, 2.45, -0.35);
      g.add(big);
      tick.push((t) => (big.rotation.y = t * 0.6));
      break;
    }
    case "bap": {
      // glass popcorn machine with a kettle and popping kernels
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.75, 0.6), glassM);
      box.position.set(-0.4, 0.42, -0.05);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.65), std("#e63946"));
      frame.position.set(-0.4, 0.83, -0.05);
      const base = frame.clone();
      base.position.y = 0.04;
      const kettle = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.14, 14), steel);
      kettle.position.set(-0.4, 0.62, -0.05);
      g.add(box, frame, base, kettle);
      const kernelG = new THREE.IcosahedronGeometry(0.035, 0);
      const pile = new THREE.InstancedMesh(kernelG, std("#fff6d8", { emissive: "#fff2c0", emissiveIntensity: 0.2 }), 60);
      for (let i = 0; i < 60; i++) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(-0.4 + (r() - 0.5) * 0.75, 0.1 + r() * r() * 0.22, -0.05 + (r() - 0.5) * 0.5),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        pile.setMatrixAt(i, m);
      }
      g.add(pile);
      const pops: THREE.Mesh[] = [];
      for (let i = 0; i < 6; i++) {
        const p = new THREE.Mesh(kernelG, std("#fff6d8"));
        pops.push(p);
        g.add(p);
      }
      tick.push((t) => {
        pops.forEach((p, i) => {
          const ph = (t * 1.4 + i / pops.length) % 1;
          const a = i * 2.1;
          p.position.set(-0.4 + Math.cos(a) * ph * 0.3, 0.55 + Math.sin(ph * Math.PI) * 0.2 - ph * 0.35, -0.05 + Math.sin(a) * ph * 0.22);
          p.rotation.set(t * 5 + i, t * 3, 0);
        });
      });
      for (let i = 0; i < 3; i++) {
        const b = makeItem(i % 2 ? "bap_caramel" : "bap_bo");
        b.position.set(0.45 + i * 0.28, 0.06, 0.2 - (i % 2) * 0.25);
        b.scale.setScalar(1.2);
        g.add(b);
      }
      break;
    }
    case "mia": {
      // sugar-cane press with a turning flywheel, a bundle of cane, cups and coconuts
      const press = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.45), steel);
      press.position.set(-0.45, 0.23, -0.2);
      const fly = new THREE.Group();
      fly.position.set(-0.76, 0.32, -0.2);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 24), std("#e63946"));
      rim.rotation.y = Math.PI / 2;
      fly.add(rim);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.56, 0.03), std("#e63946"));
        sp.rotation.x = (i / 3) * Math.PI;
        fly.add(sp);
      }
      tick.push((t) => (fly.rotation.x = -t * 2.2));
      const spout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.2), steel);
      spout.position.set(-0.45, 0.12, 0.1);
      g.add(press, fly, spout);
      const caneM = std("#b6c94a", { roughness: 0.6 });
      const nodeM = std("#7d8a2a");
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 14), std("#3a86ff"));
      bucket.position.set(0.95, -0.2, -0.45);
      g.add(bucket);
      for (let i = 0; i < 7; i++) {
        const cane = new THREE.Group();
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 1.8, 6), caneM);
        s.position.y = 0.9;
        cane.add(s);
        for (let k = 1; k < 6; k++) {
          const n = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 6), nodeM);
          n.position.y = k * 0.3;
          cane.add(n);
        }
        const a = (i / 7) * Math.PI * 2;
        cane.position.set(0.95 + Math.cos(a) * 0.09, -0.3, -0.45 + Math.sin(a) * 0.09);
        cane.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
        g.add(cane);
      }
      for (let i = 0; i < 3; i++) {
        const cup = makeItem(i === 2 ? "nuoc_mia_tac" : "nuoc_mia");
        cup.position.set(0.05 + i * 0.22, 0.05, 0.35);
        g.add(cup);
      }
      for (let i = 0; i < 4; i++) {
        const nut = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), std("#6cbf3f"));
        nut.position.set(-0.95 + (i % 2) * 0.26, 0.12 + Math.floor(i / 2) * 0.2, 0.32);
        g.add(nut);
      }
      break;
    }
    case "banhmi": {
      // glass display case of baguettes, a tea jug and sauce bottles
      const caseM = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 0.6), glassM);
      caseM.position.set(-0.3, 0.3, -0.05);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.65), std("#e63946"));
      top.position.set(-0.3, 0.6, -0.05);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.55), std("#ffffff"));
      shelf.position.set(-0.3, 0.02, -0.05);
      g.add(caseM, top, shelf);
      const loafG = new THREE.CapsuleGeometry(0.06, 0.38, 6, 10);
      const loafM = std("#e3a04f", { roughness: 0.7 });
      for (let i = 0; i < 6; i++) {
        const l = new THREE.Mesh(loafG, loafM);
        l.rotation.z = Math.PI / 2;
        l.rotation.y = 0.15;
        l.position.set(-0.6 + (i % 3) * 0.3, 0.1 + Math.floor(i / 3) * 0.12, -0.15 + Math.floor(i / 3) * 0.15);
        g.add(l);
      }
      const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.42, 16), std("#ff9f1c"));
      jug.position.set(1.0, 0.21, -0.2);
      const jugLid = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.08, 16), std("#ffffff"));
      jugLid.position.set(1.0, 0.46, -0.2);
      const tap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1), std("#e63946"));
      tap.position.set(1.0, 0.08, -0.01);
      g.add(jug, jugLid, tap);
      for (let i = 0; i < 2; i++) {
        const glassCup = makeItem("tra_da");
        glassCup.position.set(0.55 + i * 0.22, 0.06, 0.25);
        g.add(glassCup);
      }
      ["#e63946", "#3b2a20"].forEach((col, i) => {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8), std(col));
        b.position.set(0.3 + i * 0.1, 0.11, 0.25);
        g.add(b);
      });
      break;
    }
    case "keobong": {
      // cotton candy machine spinning a pink cloud, and a stand of finished sticks
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.3, 24, 1, true), std("#dfe5ee", { metalness: 0.6, roughness: 0.25, side: THREE.DoubleSide }));
      bowl.position.set(-0.15, 0.3, -0.05);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.16, 20), std("#ff9fcf"));
      base.position.set(-0.15, 0.08, -0.05);
      const cloud = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.1, 10, 24), std("#ffc2e2", { roughness: 1, transparent: true, opacity: 0.85, emissive: "#ffc2e2", emissiveIntensity: 0.3 }));
      cloud.rotation.x = Math.PI / 2;
      cloud.position.set(-0.15, 0.32, -0.05);
      tick.push((t) => {
        cloud.rotation.z = t * 6;
        cloud.scale.setScalar(1 + Math.sin(t * 3) * 0.05);
      });
      g.add(bowl, base, cloud);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.35), std("#ffffff"));
      block.position.set(-0.95, 0.09, 0.05);
      block.scale.set(0.6, 1, 1);
      g.add(block);
      (["keo_hong", "keo_xanh", "keo_cauvong", "keo_hong", "keo_xanh"] as const).forEach((id, i) => {
        const it = makeItem(id);
        it.position.set(-1.12 + i * 0.085, 0.22 + (i % 2) * 0.1, 0.05 + (i % 2 ? -0.08 : 0.08));
        g.add(it);
      });
      break;
    }
    case "bongbay": {
      // helium tank and a big bunch of balloons tied to the cart
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.6, 6, 12), std("#9aa5b1", { metalness: 0.6, roughness: 0.3 }));
      tank.position.set(1.08, 0.44, -0.3);
      g.add(tank);
      const cols = ["#ff4e6a", "#3a9bff", "#ffcf3a", "#06d6a0", "#c77dff", "#ff9f1c"];
      const lineM = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8 });
      const ballG = new THREE.SphereGeometry(1, 14, 10);
      const anchor = new THREE.Vector3(-0.3, 0.1, -0.1);
      const balls: { m: THREE.Mesh; base: THREE.Vector3; line: THREE.BufferAttribute; ph: number }[] = [];
      for (let i = 0; i < 14; i++) {
        const col = cols[i % cols.length];
        const m = new THREE.Mesh(ballG, std(col, { roughness: 0.25, emissive: col, emissiveIntensity: 0.18 }));
        m.scale.set(0.24, 0.28, 0.24);
        const a = i * 2.39, rr = 0.25 + (i % 4) * 0.13;
        const base = new THREE.Vector3(anchor.x + Math.cos(a) * rr, 1.7 + (i % 5) * 0.2, anchor.z + Math.sin(a) * rr * 0.7);
        m.position.copy(base);
        const pos = new THREE.BufferAttribute(new Float32Array([anchor.x, anchor.y, anchor.z, base.x, base.y - 0.28, base.z]), 3);
        const lg = new THREE.BufferGeometry();
        lg.setAttribute("position", pos);
        g.add(m, new THREE.Line(lg, lineM));
        balls.push({ m, base, line: pos, ph: r() * 6 });
      }
      tick.push((t) => {
        for (const b of balls) {
          b.m.position.set(b.base.x + Math.sin(t * 1.1 + b.ph) * 0.06, b.base.y + Math.sin(t * 0.8 + b.ph) * 0.04, b.base.z + Math.cos(t * 0.9 + b.ph) * 0.05);
          b.line.setXYZ(1, b.m.position.x, b.m.position.y - 0.28, b.m.position.z);
          b.line.needsUpdate = true;
        }
      });
      break;
    }
  }
  return g;
}

function buildCart(c: Cart, tick: ((t: number) => void)[]) {
  const g = new THREE.Group();
  const wood = std("#c98b4a", { roughness: 0.85 });
  // body + counter
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.62, 1.1), std(shade(c.color, -6)));
  body.position.y = 0.72;
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.3), wood);
  counter.position.y = COUNTER_Y;
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.06, 1.16), std("#ffffff"));
  skirt.position.y = 0.42;
  const panel = frontPanel(c, 2.2, 0.56);
  panel.position.set(0, 0.73, 0.556);
  g.add(body, counter, skirt, panel);
  // wheels, legs and push bar
  for (const x of [-1.22, 1.22]) {
    const w = wheel(0.4);
    w.position.set(x, 0.42, 0);
    g.add(w);
  }
  for (const x of [-0.95, 0.95]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), std("#3b2a20"));
    leg.position.set(x, 0.21, -0.4);
    g.add(leg);
  }
  const barM = std("#3b2a20");
  for (const z of [-0.4, 0.4]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), barM);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(1.42, 0.95, z);
    g.add(arm);
  }
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.86, 6), std("#e63946"));
  grip.rotation.x = Math.PI / 2;
  grip.position.set(1.69, 0.95, 0);
  g.add(grip);
  // shade
  if (c.id === "kem") g.add(umbrella("#ff8fab", "#ffffff"));
  else if (c.id === "mia") g.add(umbrella("#2fbf71", "#fff6c2"));
  else if (c.id === "keobong") g.add(umbrella("#c77dff", "#ffffff"));
  else if (c.id !== "bongbay") g.add(canopyRoof(c));
  g.add(props(c, tick));
  // menu board at the customer side
  const menu = menuBoard(c);
  menu.position.set(-1.75, 0, 0.85);
  menu.rotation.y = -0.5;
  g.add(menu);
  // little stool for the seller
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.4, 12), std("#3a86ff"));
  stool.position.set(-0.6, 0.2, -1.05);
  g.add(stool);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    m.castShadow = !mat.transparent;
    m.receiveShadow = true;
  });
  return g;
}

/** Released balloons drifting into the sky. */
interface Floater {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  t: number;
}

export class Vendors {
  group = new THREE.Group();
  colliders: Collider[] = [];
  private vendors: Vendor[] = [];
  private floaters: Floater[] = [];
  private tmp = new THREE.Vector3();

  constructor() {
    for (const c of CARTS) {
      const tick: ((t: number) => void)[] = [];
      const group = buildCart(c, tick);
      group.position.set(c.x, 0, c.z);
      group.rotation.y = c.rot;
      const seller = new Avatar(c.seller.name, c.seller.color, lookFromSeed("seller-" + c.id + c.seller.color));
      seller.addHat(c.seller.hat, shade(c.seller.color, -10));
      seller.group.position.set(SELLER.x, 0, SELLER.z);
      group.add(seller.group);
      this.group.add(group);
      this.vendors.push({ cart: c, group, seller, pose: "idle", poseUntil: 0, yaw: 0, near: false, lastHello: -1e9, tick });
      const loc = (lx: number, lz: number) => ({
        x: c.x + lx * Math.cos(c.rot) + lz * Math.sin(c.rot),
        z: c.z - lx * Math.sin(c.rot) + lz * Math.cos(c.rot),
      });
      for (const lx of [-0.6, 0.6]) this.colliders.push({ ...loc(lx, -0.15), r: 1.0 });
      this.colliders.push({ ...loc(1.55, 0), r: 0.4 }, { ...loc(-1.75, 0.85), r: 0.45 });
    }
  }

  /** Cart whose counter the player is standing at. */
  at(x: number, z: number): Cart | null {
    let best: Cart | null = null, bd = 2.6;
    for (const v of this.vendors) {
      const f = cartFront(v.cart);
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < bd) { bd = d; best = v.cart; }
    }
    return best;
  }

  /** Seller hands something over; `say` shows a speech bubble. */
  serve(id: string, now: number, say = true) {
    const v = this.vendors.find((v) => v.cart.id === id);
    if (!v) return;
    v.pose = "serve";
    v.poseUntil = now + 1100;
    if (say) v.seller.say(v.cart.thanks[Math.floor(Math.random() * v.cart.thanks.length)], now);
  }

  /** A line from the seller (used when the shop menu opens). */
  greet(id: string, now: number) {
    const v = this.vendors.find((v) => v.cart.id === id);
    if (!v) return "";
    const line = v.cart.hello[Math.floor(Math.random() * v.cart.hello.length)];
    v.seller.say(line, now);
    v.lastHello = now;
    return line;
  }

  nearestCartId(x: number, z: number, r = 8) {
    for (const v of this.vendors) if (Math.hypot(x - v.cart.x, z - v.cart.z) < r) return v.cart.id;
    return null;
  }

  /** Camera framing for the shop menu: over the customer's shoulder onto the seller. */
  shopView(id: string, pos: THREE.Vector3, look: THREE.Vector3) {
    const v = this.vendors.find((v) => v.cart.id === id);
    if (!v) return false;
    v.group.updateWorldMatrix(true, false);
    pos.set(2.4, 2.15, 3.8).applyMatrix4(v.group.matrixWorld);
    look.set(0.1, 1.3, -0.3).applyMatrix4(v.group.matrixWorld);
    return true;
  }

  releaseBalloon(obj: THREE.Object3D, scene: THREE.Scene) {
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    obj.matrixWorld.decompose(p, q, s);
    obj.removeFromParent();
    obj.position.copy(p);
    obj.quaternion.identity();
    obj.scale.copy(s);
    scene.add(obj);
    this.floaters.push({ obj, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.6, (Math.random() - 0.5) * 0.6), t: 0 });
  }

  /** `t` seconds (animation), `now` ms (bubbles), `player` = local player position. */
  update(t: number, dt: number, now: number, player: THREE.Vector3 | null) {
    for (const v of this.vendors) {
      for (const f of v.tick) f(t);
      let target = Math.sin(t * 0.3 + v.cart.x) * 0.35; // idle glance around
      let near = false;
      if (player) {
        this.tmp.copy(player);
        v.group.worldToLocal(this.tmp);
        const lx = this.tmp.x - SELLER.x, lz = this.tmp.z - SELLER.z;
        const d = Math.hypot(lx, lz);
        if (d < 9 && lz > -0.5) {
          near = true;
          target = Math.max(-1.1, Math.min(1.1, Math.atan2(lx, lz)));
        }
        if (near && !v.near && d < 7 && now - v.lastHello > 25000) {
          v.pose = "wave";
          v.poseUntil = now + 1600;
          this.greet(v.cart.id, now);
        }
      }
      v.near = near;
      v.yaw += (target - v.yaw) * (1 - Math.exp(-dt * 4));
      v.seller.group.rotation.y = v.yaw;
      if (now > v.poseUntil) v.pose = "idle";
      v.seller.animate(v.pose, 1, dt, now);
    }
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.vel.y = Math.min(3.5, f.vel.y + dt * 0.4);
      f.obj.rotation.z = Math.sin(f.t * 2) * 0.2;
      f.obj.userData.tick?.(now);
      if (f.t > 14) {
        f.obj.removeFromParent();
        return false;
      }
      return true;
    });
  }
}
