import * as THREE from "three";
import { CARTS } from "../../convex/catalog";
import { BoxCollider, Collider, canvasTexture, makeSign, rng, std } from "../util";

export const BOUNDS = { minX: -128, maxX: 128, minZ: -118, maxZ: 99 };

export type Path = { pts: [number, number][]; w: number };
export const PATHS: Path[] = [
  { pts: [[0, 104], [0, 18]], w: 8 },
  { pts: [[-12, -14], [-50, -62], [-84, -90], [-92, -94]], w: 5 },
  { pts: [[13, -14], [55, -55], [70, -62]], w: 5 },
  { pts: [[19, 5], [48, 16]], w: 5 },
  { pts: [[-19, 5], [-48, 24]], w: 5 },
];
export const PLAZA_R = 20;

function distToSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}
export function nearPath(x: number, z: number, pad: number) {
  if (Math.hypot(x, z) < PLAZA_R + pad) return true;
  for (const p of PATHS) for (let i = 0; i < p.pts.length - 1; i++) if (distToSeg(x, z, p.pts[i], p.pts[i + 1]) < p.w / 2 + pad) return true;
  return false;
}

export function buildPark(scene: THREE.Scene, blocked: (x: number, z: number) => boolean, mobile: boolean) {
  const colliders: Collider[] = [];
  const boxes: BoxCollider[] = [];
  const animated: ((t: number) => void)[] = [];

  // ---- sky ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color("#3d8ef0") }, mid: { value: new THREE.Color("#9fd2ff") }, bottom: { value: new THREE.Color("#e9f5ff") } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*1.6,0.0,1.0), 0.8)) : bottom; c = mix(bottom, c, smoothstep(-0.02, 0.12, h));
        gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog("#cfe8ff", 160, 520);

  // ---- ground ----
  const grassTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = "#6fbf5a";
    g.fillRect(0, 0, 256, 256);
    const r = rng(7);
    for (let i = 0; i < 2600; i++) {
      const l = 35 + r() * 25;
      g.fillStyle = `hsl(${100 + r() * 25}, ${45 + r() * 20}%, ${l}%)`;
      g.fillRect(r() * 256, r() * 256, 2, 3 + r() * 3);
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(220, 220);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- paths ----
  const paveTex = canvasTexture(128, 128, (g) => {
    g.fillStyle = "#e9d8b4";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#d2bd94";
    g.lineWidth = 3;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.strokeRect(x * 32 + (y % 2) * 16, y * 32, 32, 32);
  });
  paveTex.wrapS = paveTex.wrapT = THREE.RepeatWrapping;
  const pathMat = (rx: number, ry: number) => {
    const t = paveTex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  };
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, len + p.w * 0.5), pathMat(p.w / 2, len / 2));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(bx - ax, bz - az);
      m.position.set((ax + bx) / 2, 0.02, (az + bz) / 2);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  const plazaTex = canvasTexture(512, 512, (g) => {
    g.fillStyle = "#efe0c2";
    g.fillRect(0, 0, 512, 512);
    g.translate(256, 256);
    for (let r = 1; r <= 8; r++) {
      g.strokeStyle = r % 2 ? "#d9c49b" : "#e6a57e";
      g.lineWidth = r % 2 ? 4 : 10;
      g.beginPath();
      g.arc(0, 0, r * 31, 0, Math.PI * 2);
      g.stroke();
    }
    for (let a = 0; a < 16; a++) {
      g.rotate(Math.PI / 8);
      g.strokeStyle = "#d9c49b";
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(40, 0); g.lineTo(250, 0); g.stroke();
    }
  });
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_R, 64), new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.03;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // ---- fountain ----
  const fountain = new THREE.Group();
  const stone = std("#d6d0c4");
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.3, 0.7, 40, 1, true), stone);
  basin.position.y = 0.35;
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(6.05, 0.22, 8, 48), stone);
  rimM.rotation.x = Math.PI / 2;
  rimM.position.y = 0.7;
  const waterMat = new THREE.MeshStandardMaterial({ color: "#4cc9f0", roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(5.9, 40), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.55;
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 2.2, 16), stone);
  tier1.position.y = 1.1;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.0, 0.5, 24), stone);
  bowl.position.y = 2.3;
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 1.4, 12), stone);
  tier2.position.y = 3.2;
  const bowl2 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.5, 0.35, 20), stone);
  bowl2.position.y = 3.9;
  fountain.add(basin, rimM, water, tier1, bowl, tier2, bowl2);
  const jetMat = new THREE.MeshStandardMaterial({ color: "#bde9ff", transparent: true, opacity: 0.6, roughness: 0.1 });
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3, 12, 1, true), jetMat);
  jet.position.y = 5.4;
  jet.rotation.x = Math.PI;
  const jets: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 2.2, 6, 1, true), jetMat);
    const a = (i / 8) * Math.PI * 2;
    j.position.set(Math.cos(a) * 4.3, 1.4, Math.sin(a) * 4.3);
    j.rotation.z = Math.cos(a) * 0.35;
    j.rotation.x = -Math.sin(a) * 0.35;
    jets.push(j);
    fountain.add(j);
  }
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.25, 3, 8, 1, true), jetMat);
  spout.position.y = 5.5;
  fountain.add(jet, spout);
  fountain.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === stone) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(fountain);
  colliders.push({ x: 0, z: 0, r: 6.5 });
  animated.push((t) => {
    spout.scale.y = 1 + Math.sin(t * 3) * 0.12;
    jets.forEach((j, i) => (j.scale.y = 1 + Math.sin(t * 4 + i) * 0.15));
    jet.rotation.y = t;
    water.position.y = 0.55 + Math.sin(t * 2) * 0.02;
  });

  // ---- entrance gate ----
  const gate = new THREE.Group();
  gate.position.set(0, 0, 99);
  const pillarMat = std("#ff4e7a");
  for (const x of [-7, 7]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 9, 16), pillarMat);
    p.position.set(x, 4.5, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.2, 16), std("#ffd166"));
    cap.position.set(x, 10.1, 0);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), std("#ffffff"));
    ball.position.set(x, 11.4, 0);
    gate.add(p, cap, ball);
    colliders.push({ x, z: 99, r: 1.3 });
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(7, 0.45, 10, 40, Math.PI), std("#ffd166"));
  arch.position.y = 7.5;
  gate.add(arch);
  for (const side of [1, -1]) {
    const s = makeSign("CÔNG VIÊN GIẢI TRÍ", 12, 2.2, "#3a0ca3", "#ffd166", "{star} Chào mừng bạn! {star}");
    s.position.set(0, 9.3 + 0.2, side * 0.5);
    if (side < 0) s.rotation.y = Math.PI;
    gate.add(s);
  }
  gate.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
  scene.add(gate);

  // ---- fence ----
  const postGeo = new THREE.BoxGeometry(0.25, 1.6, 0.25);
  const fenceMat = std("#ffffff");
  const posts: THREE.Matrix4[] = [];
  const railSegs: { a: [number, number]; b: [number, number] }[] = [];
  const { minX, maxX, minZ, maxZ } = { minX: -130, maxX: 130, minZ: -120, maxZ: 101 };
  const edge = (a: [number, number], b: [number, number], skip?: (x: number, z: number) => boolean) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.round(len / 4);
    let segStart: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, z = a[1] + ((b[1] - a[1]) * i) / n;
      const sk = skip?.(x, z) ?? false;
      if (!sk) {
        posts.push(new THREE.Matrix4().makeTranslation(x, 0.8, z));
        if (!segStart) segStart = [x, z];
      }
      if ((sk || i === n) && segStart) {
        const prevX = a[0] + ((b[0] - a[0]) * (sk ? i - 1 : i)) / n, prevZ = a[1] + ((b[1] - a[1]) * (sk ? i - 1 : i)) / n;
        railSegs.push({ a: segStart, b: [prevX, prevZ] });
        segStart = null;
      }
    }
  };
  edge([minX, maxZ], [maxX, maxZ], (x) => Math.abs(x) < 7);
  edge([maxX, maxZ], [maxX, minZ]);
  edge([maxX, minZ], [minX, minZ]);
  edge([minX, minZ], [minX, maxZ]);
  const postMesh = new THREE.InstancedMesh(postGeo, fenceMat, posts.length);
  posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
  postMesh.castShadow = true;
  scene.add(postMesh);
  for (const s of railSegs) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (len < 0.5) continue;
    for (const y of [0.6, 1.3]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), fenceMat);
      r.position.set((s.a[0] + s.b[0]) / 2, y, (s.a[1] + s.b[1]) / 2);
      r.rotation.y = Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      scene.add(r);
    }
  }

  // distant hills
  const hillMat = std("#5ea84d", { roughness: 1 });
  const hr = rng(3);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + hr() * 0.2;
    const d = 260 + hr() * 120;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), hillMat);
    h.position.set(Math.cos(a) * d, -10, Math.sin(a) * d);
    h.scale.set(60 + hr() * 50, 25 + hr() * 35, 60 + hr() * 50);
    scene.add(h);
  }

  // ---- ride billboards: an arch over the start of each path, facing the plaza ----
  const pathSigns = [
    { path: 1, title: "TÀU LƯỢN SIÊU TỐC", bg: "#e63946", sub: "{coaster} Cao 30m · Vòng xoắn 360°" },
    { path: 2, title: "VÒNG QUAY MẶT TRỜI", bg: "#8338ec", sub: "{wheel} Ngắm toàn cảnh công viên" },
    { path: 3, title: "VÒNG NGỰA GỖ", bg: "#ff9f1c", sub: "{horse} Nhạc vui · Phi ngựa vòng quanh" },
    { path: 4, title: "NÉM PHI TIÊU", bg: "#3a86ff", sub: "{target} Bắn bóng bay · Lên bảng vàng" },
  ];
  const archPostGeo = new THREE.CylinderGeometry(0.14, 0.16, 5.6, 10);
  const archPostMat = std("#ffffff");
  for (const ps of pathSigns) {
    const p = PATHS[ps.path];
    const [ax, az] = p.pts[0], [bx, bz] = p.pts[1];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const cx = ax + ux * 4.5, cz = az + uz * 4.5;
    const half = p.w / 2 + 0.7;
    const arch = new THREE.Group();
    arch.position.set(cx, 0, cz);
    arch.rotation.y = Math.atan2(-ux, -uz); // local +z (sign front) faces back toward the plaza
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(archPostGeo, archPostMat);
      post.position.set(side * half, 2.8, 0);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), std("#ffd166"));
      ball.position.set(side * half, 5.75, 0);
      arch.add(post, ball);
      // local x axis in world space is (-uz, ux)
      colliders.push({ x: cx - uz * side * half, z: cz + ux * side * half, r: 0.35 });
    }
    // same board on both faces so it reads from the plaza and on the way back
    for (const face of [1, -1]) {
      const s = makeSign(ps.title, half * 2 + 0.6, 1.7, ps.bg, "#fff", ps.sub);
      (s.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
      s.position.set(0, 4.6, face * 0.04);
      if (face < 0) s.rotation.y = Math.PI;
      arch.add(s);
    }
    arch.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    scene.add(arch);
  }

  // ---- lamps & bunting along the avenue + paths ----
  const lampPos: [number, number][] = [];
  for (let z = 24; z <= 92; z += 12) lampPos.push([-5.2, z], [5.2, z]);
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2 + 0.26;
    const lx = Math.cos(ang) * (PLAZA_R + 0.8), lz = Math.sin(ang) * (PLAZA_R + 0.8);
    // keep path mouths clear so the ride arches are visible from the plaza
    if (PATHS.some((p) => p.pts.slice(1).some((q, i) => distToSeg(lx, lz, p.pts[i], q) < p.w / 2 + 0.6))) continue;
    lampPos.push([lx, lz]);
  }
  for (const p of PATHS.slice(1)) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let d = 8; d < len - 2; d += 14) {
        const side = (Math.round(d / 14) % 2 ? 1 : -1) * (p.w / 2 + 0.6);
        lampPos.push([ax + ((bx - ax) * d) / len + nx * side, az + ((bz - az) * d) / len + nz * side]);
      }
    }
  }
  const lampPole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 4, 8), std("#2b2d42", { metalness: 0.6 }), lampPos.length);
  const lampHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshStandardMaterial({ color: "#fff6c2", emissive: "#ffe9a0", emissiveIntensity: 0.8 }), lampPos.length);
  lampPos.forEach(([x, z], i) => {
    lampPole.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 2, z));
    lampHead.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 4.15, z));
    colliders.push({ x, z, r: 0.3 });
  });
  lampPole.castShadow = true;
  scene.add(lampPole, lampHead);

  // bunting across the avenue
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.25, 0, 0, 0.25, 0, 0, 0, -0.5, 0], 3));
  flagGeo.computeVertexNormals();
  const flagCols = ["#ff4e7a", "#ffd166", "#2ec4b6", "#3a86ff", "#8338ec", "#ff9f1c"];
  const flagsPer = 16;
  const rows = [30, 54, 78];
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), rows.length * flagsPer);
  let fi = 0;
  for (const z of rows) {
    for (let i = 0; i < flagsPer; i++) {
      const t = (i + 0.5) / flagsPer;
      const x = -5.2 + t * 10.4;
      const y = 4.0 - Math.sin(t * Math.PI) * 0.9;
      flags.setMatrixAt(fi, new THREE.Matrix4().makeTranslation(x, y, z));
      flags.setColorAt(fi++, new THREE.Color(flagCols[i % flagCols.length]));
    }
  }
  scene.add(flags);

  // benches around the plaza
  const benchMat = std("#a0522d");
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2 + Math.PI / 8;
    const r = PLAZA_R - 2.5;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (Math.abs(x) < 6 && z > 0) continue;
    const b = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), benchMat);
    seat.position.y = 0.48;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), benchMat);
    back.position.set(0, 0.8, -0.28);
    const legM = std("#333");
    for (const lx of [-0.95, 0.95]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.48, 0.55), legM);
      l.position.set(lx, 0.24, 0);
      b.add(l);
    }
    b.add(seat, back);
    b.position.set(x, 0, z);
    b.rotation.y = -ang - Math.PI / 2;
    b.traverse((o) => ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    scene.add(b);
    colliders.push({ x, z, r: 1.0 });
  }

  // flower beds in the plaza
  const flowerGeo = new THREE.SphereGeometry(0.18, 6, 4);
  const fr = rng(11);
  const flowerCount = 320;
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), flowerCount);
  const fcols = ["#ff4e7a", "#ffd166", "#ffffff", "#c77dff", "#ff9f1c"];
  for (let i = 0; i < flowerCount; i++) {
    const ang = fr() * Math.PI * 2;
    const r = 7 + fr() * 1.6;
    flowers.setMatrixAt(i, new THREE.Matrix4().makeTranslation(Math.cos(ang) * r, 0.18, Math.sin(ang) * r));
    flowers.setColorAt(i, new THREE.Color(fcols[i % fcols.length]));
  }
  const bed = new THREE.Mesh(new THREE.RingGeometry(6.8, 8.8, 48), std("#5b3a29"));
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.05;
  scene.add(flowers, bed);
  colliders.push({ x: 0, z: 0, r: 8.6 });

  // ---- trees ----
  const tr = rng(42);
  const treePos: [number, number, number][] = [];
  let tries = 0;
  const target = mobile ? 170 : 260;
  while (treePos.length < target && tries++ < 8000) {
    const x = BOUNDS.minX + 2 + tr() * (BOUNDS.maxX - BOUNDS.minX - 4);
    const z = BOUNDS.minZ + 2 + tr() * (BOUNDS.maxZ - BOUNDS.minZ - 4);
    if (nearPath(x, z, 3)) continue;
    if (blocked(x, z)) continue;
    if (Math.abs(x) < 16 && z > 30) continue;
    if (CARTS.some((k) => Math.hypot(k.x - x, k.z - z) < 5)) continue;
    if (treePos.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 16)) continue;
    treePos.push([x, z, 0.8 + tr() * 0.6]);
  }
  // also some trees outside the fence
  for (let i = 0; i < 140; i++) {
    const a = tr() * Math.PI * 2;
    const d = 150 + tr() * 90;
    treePos.push([Math.cos(a) * d, Math.sin(a) * d, 1 + tr() * 0.8]);
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6), std("#7a4e2d"), treePos.length);
  const leafGeoA = new THREE.IcosahedronGeometry(1.8, 0);
  const leafGeoB = new THREE.ConeGeometry(1.7, 4, 7);
  const roundIdx = treePos.map((_, i) => i % 3 !== 0);
  const nRound = roundIdx.filter(Boolean).length;
  const leavesA = new THREE.InstancedMesh(leafGeoA, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), nRound);
  const leavesB = new THREE.InstancedMesh(leafGeoB, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), treePos.length - nRound);
  let ia = 0, ib = 0;
  const q = new THREE.Quaternion();
  treePos.forEach(([x, z, s], i) => {
    trunk.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s)));
    const c = new THREE.Color().setHSL(0.27 + tr() * 0.08, 0.5 + tr() * 0.2, 0.32 + tr() * 0.12);
    if (roundIdx[i]) {
      leavesA.setMatrixAt(ia, new THREE.Matrix4().compose(new THREE.Vector3(x, 3.3 * s, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tr() * 6, 0)), new THREE.Vector3(s, s * 1.1, s)));
      leavesA.setColorAt(ia++, c);
    } else {
      leavesB.setMatrixAt(ib, new THREE.Matrix4().compose(new THREE.Vector3(x, 3.8 * s, z), q, new THREE.Vector3(s, s, s)));
      leavesB.setColorAt(ib++, c.offsetHSL(0.03, 0, -0.06));
    }
    if (Math.abs(x) < 135 && Math.abs(z) < 125) colliders.push({ x, z, r: 0.5 * s });
  });
  trunk.castShadow = leavesA.castShadow = leavesB.castShadow = true;
  scene.add(trunk, leavesA, leavesB);

  // ---- clouds ----
  const cloudMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, emissive: "#ffffff", emissiveIntensity: 0.25, fog: false });
  const clouds: THREE.Group[] = [];
  const cr = rng(99);
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(cr() * 4);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + cr() * 5, 1), cloudMat);
      s.position.set((j - n / 2) * 5 + cr() * 2, cr() * 3, cr() * 5);
      s.scale.y = 0.6;
      c.add(s);
    }
    c.position.set((cr() - 0.5) * 700, 90 + cr() * 50, (cr() - 0.5) * 700);
    clouds.push(c);
    scene.add(c);
  }
  animated.push((t) => {
    for (const c of clouds) {
      c.position.x += 0.02;
      if (c.position.x > 380) c.position.x = -380;
    }
    void t;
  });

  return {
    colliders,
    boxes,
    sky,
    update(t: number) {
      for (const f of animated) f(t);
    },
  };
}
