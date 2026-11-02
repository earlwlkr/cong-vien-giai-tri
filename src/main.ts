import "./style.css";
import * as THREE from "three";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Avatar, Pose, HIP_HEIGHT, EYE_HEIGHT, EYE_OFFSET } from "./avatar";
import { Input } from "./input";
import { Sfx } from "./audio";
import { isTouch, damp, dampAngle, BoxCollider, Collider } from "./util";
import { Coaster, SEATS } from "./world/coaster";
import { FerrisWheel } from "./world/ferris";
import { Carousel } from "./world/carousel";
import { Darts } from "./world/darts";
import { buildPark, BOUNDS, PATHS, PLAZA_R } from "./world/park";

type Ride = { kind: string; key: string; seat: number; start: number };
type PlayerDoc = {
  _id: Id<"players">;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: string;
  ride: Ride | null;
  lastSeen: number;
};
type RideResult = { ok: boolean; done: boolean; speed?: number; g?: number; waiting?: number; lift?: boolean; height?: number; left?: number };

const $ = (id: string) => document.getElementById(id)!;
if (isTouch) document.body.classList.add("touch");
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;

// ---------------- renderer / scene ----------------
const canvas = $("game") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch || devicePixelRatio < 2, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1500);
const hemi = new THREE.HemisphereLight("#d6ecff", "#5d7d3a", 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff1d6", 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
const SUN_OFFSET = new THREE.Vector3(70, 110, 45);
scene.add(sun, sun.target);

// ---------------- world ----------------
const coaster = new Coaster();
scene.add(coaster.group);
const wheel = new FerrisWheel(70, -70);
scene.add(wheel.group);
const carousel = new Carousel(58, 18);
scene.add(carousel.group);
const darts = new Darts(-52, 16);
darts.attach(scene);
const dartsTarget = new THREE.Vector3(darts.origin.x, 2.3, darts.origin.z - 3.3);

const coasterCells = new Set<string>();
for (const s of coaster.xzSamples) {
  const cx = Math.floor(s.x / 4), cz = Math.floor(s.z / 4);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) coasterCells.add(`${cx + a},${cz + b}`);
}
function blocked(x: number, z: number) {
  if (coasterCells.has(`${Math.floor(x / 4)},${Math.floor(z / 4)}`)) return true;
  if (x > -106 && x < -78 && z > -104 && z < -90) return true;
  if (Math.abs(x - 70) < 22 && Math.abs(z + 70) < 12) return true;
  if (Math.hypot(x - 58, z - 18) < 14) return true;
  if (Math.abs(x + 52) < 8 && z > 8 && z < 27) return true;
  if (Math.abs(x) < 14 && z > 90) return true;
  return false;
}
const park = buildPark(scene, blocked, isTouch);
const colliders: Collider[] = [...park.colliders, ...coaster.colliders, ...wheel.colliders, ...carousel.colliders];
const boxes: BoxCollider[] = [...park.boxes, ...darts.boxes];

type ZoneId = "coaster" | "wheel" | "carousel" | "darts";
const zones: { id: ZoneId; x: number; z: number; r: number }[] = [
  { id: "coaster", x: coaster.boardZone.x, z: coaster.boardZone.z, r: 7 },
  { id: "wheel", x: wheel.boardZone.x, z: wheel.boardZone.z, r: 5 },
  { id: "carousel", x: carousel.center.x, z: carousel.center.z, r: 11.5 },
  { id: "darts", x: darts.standPoint.x, z: darts.standPoint.z + 0.8, r: 3.4 },
];
const places = [
  { n: "🚪 Cổng chính", x: 0, z: 92, r: 14 },
  { n: "⛲ Quảng trường", x: 0, z: 0, r: 24 },
  { n: "🎢 Tàu lượn siêu tốc", x: -90, z: -95, r: 22 },
  { n: "🎡 Vòng quay mặt trời", x: 70, z: -66, r: 24 },
  { n: "🎠 Vòng ngựa gỗ", x: 58, z: 18, r: 17 },
  { n: "🎯 Ném phi tiêu", x: -52, z: 19, r: 12 },
  { n: "🍦 Phố ẩm thực", x: 0, z: 52, r: 22 },
];

// ---------------- state ----------------
const input = new Input(canvas);
const sfx = new Sfx();
const me = {
  pos: new THREE.Vector3(0, 0, 84),
  vel: new THREE.Vector3(),
  vy: 0,
  yaw: Math.PI,
  onGround: true,
  pose: "idle" as Pose,
};
let joined = false;
let myId: Id<"players"> | null = null;
let myName = "";
let myColor = "#ff4e7a";
let myAvatar: Avatar | null = null;
let camMode: "tp" | "fp" = "tp";
let camYaw = Math.PI, camPitch = -0.22, camDist = 6;
let rideLookYaw = 0, rideLookPitch = -0.1;
let myRide: Ride | null = null;
let boardingPending = false;
let mode: "walk" | "ride" | "darts" = "walk";
let coasterQueued = false;
let fov = 70;

// ---------------- networking ----------------
let client: ConvexClient | null = null;
let timeOffset = 0;
const serverNow = () => Date.now() + timeOffset;
interface Remote {
  avatar: Avatar;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  anim: string;
  ride: Ride | null;
  name: string;
  color: string;
}
const remotes = new Map<string, Remote>();
let latestPlayers: PlayerDoc[] = [];

function syncRemotes(list: PlayerDoc[]) {
  latestPlayers = list;
  const now = serverNow();
  const seen = new Set<string>();
  for (const p of list) {
    if (p._id === myId) continue;
    if (now - p.lastSeen > 20000) continue;
    seen.add(p._id);
    let r = remotes.get(p._id);
    if (r && (r.name !== p.name || r.color !== p.color)) {
      r.avatar.dispose();
      remotes.delete(p._id);
      r = undefined;
    }
    if (!r) {
      const avatar = new Avatar(p.name, p.color, p._id);
      scene.add(avatar.group);
      r = { avatar, pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(), yaw: p.ry, targetYaw: p.ry, anim: p.anim, ride: null, name: p.name, color: p.color };
      remotes.set(p._id, r);
    }
    r.target.set(p.x, p.y, p.z);
    r.targetYaw = p.ry;
    r.anim = p.anim;
    r.ride = p.ride;
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) {
      r.avatar.dispose();
      remotes.delete(id);
    }
  }
  $("online").textContent = `👥 ${seen.size + (joined ? 1 : 0)} đang chơi`;
}

async function syncTime() {
  if (!client) return;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const s = await client.mutation(api.time.now, {});
    const t1 = Date.now();
    if (t1 - t0 < best) {
      best = t1 - t0;
      timeOffset = s + best / 2 - t1;
    }
  }
}

let lastSent = { x: 0, y: 0, z: 0, ry: 0, anim: "", t: 0 };
let inflight = false;
const sendPos = new THREE.Vector3();
function netTick(pos: THREE.Vector3, ry: number, anim: string) {
  if (!client || !myId || inflight) return;
  const t = performance.now();
  if (t - lastSent.t < 110) return;
  const moved = Math.abs(pos.x - lastSent.x) + Math.abs(pos.y - lastSent.y) + Math.abs(pos.z - lastSent.z) > 0.04 || Math.abs(ry - lastSent.ry) > 0.05 || anim !== lastSent.anim;
  if (!moved && t - lastSent.t < 2500) return;
  lastSent = { x: pos.x, y: pos.y, z: pos.z, ry, anim, t };
  inflight = true;
  client
    .mutation(api.players.update, { id: myId, x: pos.x, y: pos.y, z: pos.z, ry, anim })
    .then((ok) => {
      if (ok === false) rejoin();
    })
    .catch(() => {})
    .finally(() => (inflight = false));
}

async function rejoin() {
  if (!client) return;
  if (myRide) leaveRideLocal();
  myId = await client.mutation(api.players.join, { name: myName, color: myColor, x: me.pos.x, z: me.pos.z });
}

// ---------------- chat ----------------
const chatLog = $("chatLog");
const chatForm = $("chatForm") as HTMLFormElement;
const chatInput = $("chatInput") as HTMLInputElement;
const seenMsgs = new Set<string>();
let firstChat = true;
function addChatLine(name: string | null, color: string, text: string) {
  const d = document.createElement("div");
  d.className = "msg" + (name ? "" : " sys");
  if (name) {
    const b = document.createElement("b");
    b.style.color = color;
    b.textContent = name + ":";
    d.appendChild(b);
  }
  d.appendChild(document.createTextNode(text));
  chatLog.appendChild(d);
  while (chatLog.children.length > 40) chatLog.firstElementChild!.remove();
  setTimeout(() => d.classList.add("old"), 12000);
}
function openChat() {
  if (!joined) return;
  chatForm.classList.remove("hidden");
  $("chat").classList.add("open");
  chatInput.focus();
}
function closeChat() {
  chatInput.blur();
  chatForm.classList.add("hidden");
  $("chat").classList.remove("open");
}
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  chatInput.value = "";
  if (text && client && myId) client.mutation(api.chat.send, { id: myId, text }).catch(() => toast("Không gửi được tin nhắn"));
  closeChat();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
});
$("chatBtn").addEventListener("click", () => (chatForm.classList.contains("hidden") ? openChat() : closeChat()));

// ---------------- UI helpers ----------------
let toastTimer = 0;
function toast(t: string, ms = 2600) {
  const el = $("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}
const setText = (() => {
  const cache = new Map<string, string>();
  return (id: string, text: string) => {
    if (cache.get(id) === text) return;
    cache.set(id, text);
    $(id).textContent = text;
  };
})();
const show = (id: string, on: boolean) => $(id).classList.toggle("hidden", !on);

function toggleCam() {
  camMode = camMode === "tp" ? "fp" : "tp";
  if (camMode === "fp") camPitch = Math.max(-0.6, Math.min(0.3, camPitch + 0.15));
  else camPitch = Math.min(camPitch, -0.15);
  rideLookPitch = camMode === "fp" ? -0.05 : -0.42;
  toast(camMode === "fp" ? "👁 Góc nhìn thứ nhất" : "🎥 Góc nhìn thứ ba", 1200);
}
$("camBtn").addEventListener("click", toggleCam);
$("soundBtn").addEventListener("click", () => {
  sfx.init();
  $("soundBtn").textContent = sfx.toggle() ? "🔊" : "🔇";
});
$("jumpBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  input.jumpQueued = true;
});
$("exitBtn").addEventListener("click", () => leaveActivity());
$("prompt").addEventListener("click", () => interact());
$("exitBtn").textContent = isTouch ? "⬅ Rời trò chơi" : "⬅ Rời trò chơi (Q)";

input.onKey = (code) => {
  if (!joined) return;
  if (code === "KeyV") toggleCam();
  else if (code === "KeyE") interact();
  else if (code === "KeyQ" || code === "Escape") leaveActivity();
  else if (code === "Enter") openChat();
};
input.onTap = (x, y) => {
  if (mode !== "darts") return;
  darts.throwAt((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, camera, scene);
};
darts.onPop = (gold) => {
  sfx.pop();
  if (gold) sfx.ding();
};
darts.onThrow = () => sfx.whoosh();

// ---------------- rides ----------------
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function ridePose(ride: Ride, now: number, pos: THREE.Vector3, quat: THREE.Quaternion): RideResult {
  switch (ride.kind) {
    case "coaster":
      return coaster.seatPose(ride.key, ride.seat, now, pos, quat);
    case "wheel":
      return wheel.seatPose(ride.key, ride.seat, ride.start, now, pos, quat);
    case "carousel":
      return carousel.seatPose(ride.key, now, pos, quat);
  }
  return { ok: false, done: true };
}
function placeOnSeat(a: Avatar, pos: THREE.Vector3, quat: THREE.Quaternion) {
  a.group.quaternion.copy(quat);
  a.group.position.copy(pos).sub(new THREE.Vector3(0, HIP_HEIGHT, 0).applyQuaternion(quat));
}
function ridePoseName(kind: string, speed = 0): Pose {
  if (kind === "carousel") return "horse";
  if (kind === "coaster" && speed > 13) return "cheer";
  return "sit";
}

async function doBoard(kind: string, key: string, maxSeats: number, start: number) {
  if (!client || !myId || boardingPending) return;
  boardingPending = true;
  try {
    const r = await client.mutation(api.players.board, { id: myId, kind, key, maxSeats, start });
    if (!r) {
      toast("Hết chỗ rồi, thử lại sau nhé! 😅");
      return;
    }
    myRide = r;
    mode = "ride";
    rideLookYaw = 0;
    rideLookPitch = camMode === "fp" ? -0.05 : -0.42;
    input.resetStick();
    sfx.chime();
    show("exitBtn", true);
    show("prompt", false);
  } catch {
    toast("Lỗi kết nối, thử lại nhé");
  } finally {
    boardingPending = false;
  }
}

function boardCoaster() {
  const st = coaster.boardable(serverNow());
  if (!st) {
    coasterQueued = !coasterQueued;
    if (coasterQueued) toast("⏳ Đã xếp hàng! Tàu tới là lên ngay", 1800);
    return;
  }
  coasterQueued = false;
  doBoard("coaster", st.key, SEATS, st.cycleStart);
}

function interact() {
  if (!joined || mode !== "walk") return;
  const z = currentZone();
  if (!z) return;
  sfx.init();
  const now = serverNow();
  if (z.id === "coaster") boardCoaster();
  else if (z.id === "wheel") doBoard("wheel", `wheel:${wheel.bottomGondola(now)}`, wheel.seats, now);
  else if (z.id === "carousel") {
    const taken = new Set<number>();
    for (const p of latestPlayers) {
      if (p._id !== myId && p.ride?.kind === "carousel" && now - p.lastSeen < 20000) taken.add(+p.ride.key.split(":")[1]);
    }
    const i = carousel.nearestHorse(me.pos.x, me.pos.z, now, taken);
    if (i < 0) toast("Hết ngựa rồi! 🐴");
    else doBoard("carousel", `carousel:${i}`, 1, now);
  } else if (z.id === "darts") startDarts();
}

function leaveRideLocal() {
  if (!myRide) return;
  const now = serverNow();
  const exit =
    myRide.kind === "coaster" ? coaster.exitPoint :
    myRide.kind === "wheel" ? wheel.exitPoint :
    carousel.exitFor(myRide.key, now, new THREE.Vector3());
  me.pos.copy(exit);
  me.vel.set(0, 0, 0);
  me.vy = 0;
  myRide = null;
  mode = "walk";
  camera.up.copy(UP);
  sfx.setWind(0);
  show("exitBtn", false);
  show("rideHud", false);
  show("speedo", false);
}
function leaveRide() {
  if (!myRide) return;
  leaveRideLocal();
  if (client && myId) client.mutation(api.players.unboard, { id: myId, x: me.pos.x, y: 0, z: me.pos.z }).catch(() => {});
}

function startDarts() {
  mode = "darts";
  me.pos.copy(darts.standPoint);
  me.yaw = Math.PI;
  darts.start();
  input.tapMode = true;
  input.resetStick();
  show("dartsHud", true);
  show("exitBtn", true);
  show("prompt", false);
  closeChat();
  sfx.chime();
}
function endDarts(finished: boolean) {
  if (mode !== "darts") return;
  const score = darts.score;
  darts.stop();
  input.tapMode = false;
  mode = "walk";
  me.pos.set(darts.standPoint.x, 0, darts.standPoint.z + 2.2);
  camYaw = Math.PI;
  camPitch = -0.2;
  show("dartsHud", false);
  show("exitBtn", false);
  if (finished) {
    toast(`⏱ Hết giờ! Bạn được ${score} điểm 🎯`, 3500);
    sfx.ding();
    if (client && myId && score > 0) client.mutation(api.scores.submit, { id: myId, game: "darts", score }).catch(() => {});
  }
}

function leaveActivity() {
  if (mode === "ride") leaveRide();
  else if (mode === "darts") endDarts(false);
  else if (coasterQueued) coasterQueued = false;
}

function currentZone() {
  for (const z of zones) if (Math.hypot(me.pos.x - z.x, me.pos.z - z.z) < z.r) return z;
  return null;
}

// leaderboard
let topScores: { name: string; color: string; score: number }[] = [];
function renderBoard() {
  const b = $("board");
  b.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = "🏆 Bảng vàng Ném Phi Tiêu";
  b.appendChild(h);
  const ol = document.createElement("ol");
  if (!topScores.length) {
    const li = document.createElement("li");
    li.textContent = "Chưa có ai – hãy là người đầu tiên!";
    ol.appendChild(li);
  }
  for (const s of topScores) {
    const li = document.createElement("li");
    const nm = document.createElement("b");
    nm.style.color = s.color;
    nm.textContent = s.name;
    li.append(nm, ` – ${s.score}`);
    ol.appendChild(li);
  }
  b.appendChild(ol);
}

// ---------------- join ----------------
const COLORS = ["#ff4e7a", "#ff9f1c", "#ffd166", "#06d6a0", "#2ec4b6", "#3a86ff", "#8338ec", "#f72585", "#8d99ae", "#e63946"];
const colorsEl = $("colors");
myColor = localStorage.getItem("cvgt-color") || COLORS[Math.floor(Math.random() * COLORS.length)];
for (const c of COLORS) {
  const sw = document.createElement("div");
  sw.className = "sw" + (c === myColor ? " sel" : "");
  sw.style.background = c;
  sw.onclick = () => {
    myColor = c;
    colorsEl.querySelectorAll(".sw").forEach((e) => e.classList.remove("sel"));
    sw.classList.add("sel");
  };
  colorsEl.appendChild(sw);
}
const nameInput = $("nameInput") as HTMLInputElement;
nameInput.value = localStorage.getItem("cvgt-name") || "";
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") join();
});
$("joinBtn").addEventListener("click", () => join());

async function join() {
  const btn = $("joinBtn") as HTMLButtonElement;
  if (btn.disabled) return;
  myName = nameInput.value.trim().slice(0, 18) || "Khách " + Math.floor(100 + Math.random() * 900);
  localStorage.setItem("cvgt-name", nameInput.value.trim());
  localStorage.setItem("cvgt-color", myColor);
  sfx.init();
  if (!CONVEX_URL) {
    $("joinStatus").textContent = "Thiếu cấu hình máy chủ (VITE_CONVEX_URL).";
    return;
  }
  btn.disabled = true;
  $("joinStatus").textContent = "";
  btn.textContent = "Đang kết nối…";
  try {
    client = client ?? new ConvexClient(CONVEX_URL);
    await syncTime();
    me.pos.set((Math.random() - 0.5) * 6, 0, 84 + Math.random() * 4);
    myId = await client.mutation(api.players.join, { name: myName, color: myColor, x: me.pos.x, z: me.pos.z });
    client.onUpdate(api.players.list, {}, (list) => syncRemotes(list as PlayerDoc[]));
    client.onUpdate(api.chat.recent, {}, (msgs) => {
      const now = serverNow();
      for (const m of msgs) {
        if (seenMsgs.has(m._id)) continue;
        seenMsgs.add(m._id);
        addChatLine(m.name, m.color, m.text);
        if (!firstChat && now - m._creationTime < 20000) {
          if (m.playerId === myId) myAvatar?.say(m.text, performance.now());
          else remotes.get(m.playerId)?.avatar.say(m.text, performance.now());
          if (m.playerId !== myId) sfx.chime();
        }
      }
      firstChat = false;
    });
    client.onUpdate(api.scores.top, { game: "darts" }, (s) => {
      topScores = s;
      renderBoard();
    });
    myAvatar = new Avatar(myName, myColor, myId);
    scene.add(myAvatar.group);
    joined = true;
    camYaw = Math.PI;
    camPitch = -0.2;
    show("join", false);
    show("ui", true);
    addChatLine(null, "", `Chào mừng ${myName} đến Công Viên Giải Trí! 🎉 Hãy thử tàu lượn siêu tốc ở phía Tây Bắc nhé.`);
    toast(isTouch ? "Kéo bên trái để đi, bên phải để nhìn 👆" : "WASD để đi · kéo chuột để nhìn · V đổi góc nhìn", 4000);
    setInterval(() => syncTime().catch(() => {}), 60000);
  } catch (e) {
    console.error(e);
    $("joinStatus").textContent = "Không kết nối được máy chủ. Thử lại nhé!";
    btn.disabled = false;
    btn.textContent = "Vào công viên ▶";
  }
}
window.addEventListener("pagehide", () => {
  if (client && myId) client.mutation(api.players.leave, { id: myId }).catch(() => {});
});

// ---------------- minimap ----------------
const mm = $("minimap") as HTMLCanvasElement;
const mmCtx = mm.getContext("2d")!;
const MM = { x0: -135, z0: -125, size: 270 };
const toMap = (x: number, z: number) => [((x - MM.x0) / MM.size) * mm.width, ((z - MM.z0) / MM.size) * mm.height + 6] as const;
const mmBg = document.createElement("canvas");
mmBg.width = mm.width;
mmBg.height = mm.height;
{
  const g = mmBg.getContext("2d")!;
  g.fillStyle = "#79c35f";
  g.fillRect(0, 0, mm.width, mm.height);
  g.strokeStyle = "#f2e2bf";
  g.lineCap = "round";
  for (const p of PATHS) {
    g.lineWidth = Math.max(2, (p.w / MM.size) * mm.width);
    g.beginPath();
    p.pts.forEach(([x, z], i) => (i ? g.lineTo(...toMap(x, z)) : g.moveTo(...toMap(x, z))));
    g.stroke();
  }
  g.fillStyle = "#f2e2bf";
  g.beginPath();
  g.arc(...toMap(0, 0), (PLAZA_R / MM.size) * mm.width, 0, 7);
  g.fill();
  g.strokeStyle = "#e63946";
  g.lineWidth = 1.5;
  g.beginPath();
  coaster.xzSamples.forEach((s, i) => (i % 4 ? 0 : i ? g.lineTo(...toMap(s.x, s.z)) : g.moveTo(...toMap(s.x, s.z))));
  g.closePath();
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,.8)";
  g.lineWidth = 1;
  const [bx0, bz0] = toMap(BOUNDS.minX, BOUNDS.minZ);
  const [bx1, bz1] = toMap(BOUNDS.maxX, BOUNDS.maxZ);
  g.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
  g.font = "13px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [e, x, z] of [["🎢", -92, -92], ["🎡", 70, -70], ["🎠", 58, 18], ["🎯", -52, 16], ["⛲", 0, 0], ["🚪", 0, 96]] as const) g.fillText(e, ...toMap(x, z));
}
function drawMinimap() {
  mmCtx.drawImage(mmBg, 0, 0);
  const now = serverNow();
  for (const r of remotes.values()) {
    const p = r.avatar.group.position;
    const [x, y] = toMap(p.x, p.z);
    mmCtx.fillStyle = r.color;
    mmCtx.strokeStyle = "#fff";
    mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    mmCtx.arc(x, y, 3, 0, 7);
    mmCtx.fill();
    mmCtx.stroke();
  }
  void now;
  const p = myAvatar ? myAvatar.group.position : me.pos;
  const [x, y] = toMap(p.x, p.z);
  const yaw = mode === "walk" ? me.yaw : me.yaw;
  mmCtx.save();
  mmCtx.translate(x, y);
  mmCtx.rotate(-yaw + Math.PI);
  mmCtx.fillStyle = "#fff";
  mmCtx.strokeStyle = "#1b2340";
  mmCtx.lineWidth = 1.5;
  mmCtx.beginPath();
  mmCtx.moveTo(0, -6);
  mmCtx.lineTo(4.5, 5);
  mmCtx.lineTo(0, 2.5);
  mmCtx.lineTo(-4.5, 5);
  mmCtx.closePath();
  mmCtx.fill();
  mmCtx.stroke();
  mmCtx.restore();
}

// ---------------- physics helpers ----------------
const PLAYER_R = 0.35;
function collide(p: THREE.Vector3) {
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const rr = c.r + PLAYER_R;
    if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
  for (const b of boxes) {
    const minX = b.minX - PLAYER_R, maxX = b.maxX + PLAYER_R, minZ = b.minZ - PLAYER_R, maxZ = b.maxZ + PLAYER_R;
    if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
      const pen = [p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z];
      const i = pen.indexOf(Math.min(...pen));
      if (i === 0) p.x = minX;
      else if (i === 1) p.x = maxX;
      else if (i === 2) p.z = minZ;
      else p.z = maxZ;
    }
  }
  p.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, p.x));
  p.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, p.z));
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
let frameNo = 0;
let clackTimer = 0;
let lastWaiting = 0;
const lookDir = new THREE.Vector3();
const eye = new THREE.Vector3();
const focus = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = serverNow();
  frameNo++;

  coaster.update(now);
  wheel.update(now);
  carousel.update(now);
  park.update(t);
  darts.update(dt, now, scene);

  const look = input.consumeLook();
  const sens = isTouch ? 0.006 : 0.0045;

  if (!joined) {
    // attract mode: slow orbit
    const a = t * 0.05;
    camera.position.set(Math.sin(a) * 95, 38, Math.cos(a) * 95 - 20);
    camera.up.copy(UP);
    camera.lookAt(-10, 6, -30);
    focus.set(0, 0, -20);
  } else if (mode === "walk") {
    camYaw -= look.dx * sens;
    camPitch -= look.dy * sens;
    if (look.zoom) {
      if (camMode === "tp") {
        camDist = Math.max(2.5, Math.min(16, camDist + look.zoom * 0.8));
        if (look.zoom < 0 && camDist <= 2.5) { camMode = "fp"; camPitch = Math.max(camPitch, -0.4); }
      } else if (look.zoom > 0) {
        camMode = "tp";
        camDist = 3.5;
      }
    }
    camPitch = camMode === "fp" ? Math.max(-1.45, Math.min(1.45, camPitch)) : Math.max(-1.25, Math.min(0.45, camPitch));

    const mv = input.move();
    const speed = mv.run ? 8.5 : 4.6;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const tx = (fx * mv.y + rx * mv.x) * speed, tz = (fz * mv.y + rz * mv.x) * speed;
    const accel = me.onGround ? 12 : 3;
    me.vel.x = damp(me.vel.x, tx, accel, dt);
    me.vel.z = damp(me.vel.z, tz, accel, dt);
    if (input.consumeJump() && me.onGround) {
      me.vy = 6.8;
      me.onGround = false;
    }
    me.vy -= 20 * dt;
    me.pos.x += me.vel.x * dt;
    me.pos.z += me.vel.z * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= 0) {
      me.pos.y = 0;
      me.vy = 0;
      me.onGround = true;
    }
    collide(me.pos);
    const hs = Math.hypot(me.vel.x, me.vel.z);
    if (camMode === "fp") me.yaw = camYaw;
    else if (hs > 0.3) me.yaw = dampAngle(me.yaw, Math.atan2(me.vel.x, me.vel.z), 12, dt);
    me.pose = !me.onGround ? "jump" : hs > 6 ? "run" : hs > 0.4 ? "walk" : "idle";

    // camera
    lookDir.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
    camera.up.copy(UP);
    if (camMode === "fp") {
      eye.copy(me.pos).y += EYE_HEIGHT;
      camera.position.copy(eye).addScaledVector(lookDir, 0.12);
      camera.lookAt(eye.addScaledVector(lookDir, 10));
    } else {
      eye.copy(me.pos).y += 1.6;
      camera.position.copy(eye).addScaledVector(lookDir, -camDist);
      if (camera.position.y < 0.4) camera.position.y = 0.4;
      camera.lookAt(eye);
    }
    fov = damp(fov, 70, 4, dt);
    focus.copy(me.pos);
    if (myAvatar) {
      myAvatar.group.position.copy(me.pos);
      myAvatar.group.rotation.set(0, me.yaw, 0);
      myAvatar.animate(me.pose, hs / 4.6, dt, performance.now());
      myAvatar.setFirstPerson(camMode === "fp");
      myAvatar.group.visible = true;
    }
    netTick(me.pos, me.yaw, me.pose);

    // zones / prompt
    const z = currentZone();
    if (!z && coasterQueued) coasterQueued = false;
    if (z) {
      let label = "";
      if (z.id === "coaster") {
        const st = coaster.boardable(now);
        if (coasterQueued) {
          if (coaster.boardable(now, 3)) boardCoaster();
          label = `⏳ Đang chờ tàu… ${Math.ceil(coaster.nextBoarding(now))}s (bấm để hủy)`;
        } else if (st) label = `🎢 Lên tàu lượn! Tàu chạy sau ${Math.ceil(st.dwellLeft)}s${isTouch ? "" : " (E)"}`;
        else label = `🎢 Xếp hàng chờ tàu – ${Math.ceil(coaster.nextBoarding(now))}s${isTouch ? "" : " (E)"}`;
      } else if (z.id === "wheel") label = `🎡 Lên vòng quay mặt trời${isTouch ? "" : " (E)"}`;
      else if (z.id === "carousel") label = `🎠 Cưỡi ngựa gỗ${isTouch ? "" : " (E)"}`;
      else label = `🎯 Chơi ném phi tiêu${isTouch ? "" : " (E)"}`;
      setText("prompt", label);
    }
    show("prompt", !!z);
    show("board", Math.hypot(me.pos.x - darts.origin.x, me.pos.z - darts.origin.z) < 16);
    sfx.setWind(0);
  } else if (mode === "ride" && myRide) {
    rideLookYaw -= look.dx * sens;
    rideLookPitch -= look.dy * sens;
    if (look.zoom && camMode === "tp") camDist = Math.max(2.5, Math.min(16, camDist + look.zoom * 0.8));
    if (camMode === "fp") rideLookYaw = Math.max(-2.4, Math.min(2.4, rideLookYaw));
    rideLookPitch = Math.max(-1.3, Math.min(1.2, rideLookPitch));
    input.consumeJump();
    const res = ridePose(myRide, now, tmpPos, tmpQuat);
    if (!res.ok || res.done) {
      const wasCoaster = myRide.kind === "coaster";
      const wasWheel = myRide.kind === "wheel";
      leaveRide();
      if (wasCoaster) toast("🎉 Tuyệt vời! Bạn đã chinh phục tàu lượn siêu tốc!", 3500);
      else if (wasWheel) toast("🎡 Hết một vòng – cảnh đẹp không?", 3000);
      sfx.ding();
    } else {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQuat);
      eye.set(0, EYE_OFFSET, 0.06).applyQuaternion(tmpQuat).add(tmpPos);
      lookDir.set(Math.sin(rideLookYaw) * Math.cos(rideLookPitch), Math.sin(rideLookPitch), Math.cos(rideLookYaw) * Math.cos(rideLookPitch)).applyQuaternion(tmpQuat);
      const speed = res.speed ?? 0;
      if (camMode === "fp") {
        camera.position.copy(eye);
        if (myRide.kind === "coaster" && speed > 8) {
          const sh = (speed - 8) * 0.0012;
          camera.position.x += (Math.random() - 0.5) * sh;
          camera.position.y += (Math.random() - 0.5) * sh;
        }
        camera.up.copy(up);
        camera.lookAt(eye.clone().add(lookDir));
      } else {
        const dist = myRide.kind === "wheel" ? Math.max(camDist, 8) : myRide.kind === "coaster" ? Math.max(camDist, 7.5) : camDist;
        camera.position.copy(eye).addScaledVector(lookDir, -dist);
        camera.up.copy(myRide.kind === "coaster" ? up : UP);
        camera.lookAt(eye);
      }
      fov = damp(fov, myRide.kind === "coaster" ? 70 + Math.min(20, speed * 0.75) : 70, 3, dt);
      focus.copy(tmpPos);
      if (myAvatar) {
        placeOnSeat(myAvatar, tmpPos, tmpQuat);
        myAvatar.animate(ridePoseName(myRide.kind, speed), 1, dt, performance.now());
        myAvatar.setFirstPerson(camMode === "fp");
      }
      sendPos.copy(tmpPos);
      netTick(sendPos, me.yaw, ridePoseName(myRide.kind));

      // HUD
      if (myRide.kind === "coaster") {
        const waiting = res.waiting ?? 0;
        if (waiting > 0) {
          setText("rideHud", `🎢 Tàu khởi hành sau ${Math.ceil(waiting)} giây… Thắt dây an toàn! 🔒`);
          show("rideHud", true);
          show("speedo", false);
        } else {
          if (lastWaiting > 0) { sfx.ding(); toast("🚀 Xuất phát!", 1500); }
          show("rideHud", !!res.lift);
          if (res.lift) setText("rideHud", "⛓️ Đang lên dốc 30m… chuẩn bị tinh thần!");
          show("speedo", true);
          setText("speedVal", String(Math.round(speed * 3.6)));
          setText("gVal", `${(res.g ?? 1).toFixed(1)} G`);
        }
        lastWaiting = waiting;
        sfx.setWind(Math.max(0, Math.min(1, (speed - 3) / 22)));
        if (res.lift) {
          clackTimer -= dt;
          if (clackTimer <= 0) { sfx.clack(); clackTimer = 0.22; }
        }
      } else if (myRide.kind === "wheel") {
        setText("rideHud", `🎡 Độ cao ${Math.max(0, res.height ?? 0).toFixed(0)} m · còn ${Math.ceil(res.left ?? 0)}s`);
        show("rideHud", true);
        sfx.setWind(Math.max(0, ((res.height ?? 0) - 15) / 40));
      } else {
        setText("rideHud", "🎠 Phi ngựa thôi! Nhấn “Rời trò chơi” để xuống");
        show("rideHud", true);
      }
    }
  } else if (mode === "darts") {
    input.consumeJump();
    const sway = Math.sin(t * 0.9) * 0.02;
    camera.position.copy(darts.eye).add(new THREE.Vector3(sway, Math.sin(t * 1.3) * 0.015, 0));
    camera.up.copy(UP);
    camera.lookAt(dartsTarget);
    fov = damp(fov, 62, 4, dt);
    focus.copy(darts.origin);
    if (myAvatar) {
      myAvatar.group.position.copy(darts.standPoint);
      myAvatar.group.rotation.set(0, Math.PI, 0);
      myAvatar.animate("throw", 1, dt, performance.now());
      myAvatar.group.visible = false;
    }
    netTick(darts.standPoint, Math.PI, "throw");
    setText("dScore", String(darts.score));
    setText("dTime", String(Math.ceil(darts.timeLeft)));
    show("board", true);
    if (darts.timeLeft <= 0) endDarts(true);
  }
  if (myAvatar && mode !== "darts") myAvatar.group.visible = true;

  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // remotes
  for (const r of remotes.values()) {
    let pose: Pose = (["idle", "walk", "run", "jump", "throw"].includes(r.anim) ? r.anim : "idle") as Pose;
    let seated = false;
    if (r.ride) {
      const res = ridePose(r.ride, now, tmpPos, tmpQuat);
      if (res.ok && !res.done) {
        placeOnSeat(r.avatar, tmpPos, tmpQuat);
        pose = ridePoseName(r.ride.kind, res.speed ?? 0);
        r.pos.copy(tmpPos);
        seated = true;
      }
    }
    if (!seated) {
      if (r.pos.distanceToSquared(r.target) > 100) r.pos.copy(r.target);
      r.pos.x = damp(r.pos.x, r.target.x, 10, dt);
      r.pos.y = damp(r.pos.y, r.target.y, 10, dt);
      r.pos.z = damp(r.pos.z, r.target.z, 10, dt);
      r.yaw = dampAngle(r.yaw, r.targetYaw, 10, dt);
      r.avatar.group.position.copy(r.pos);
      r.avatar.group.rotation.set(0, r.yaw, 0);
      if (pose === "sit" || pose === "horse" || pose === "cheer") pose = "idle";
    }
    r.avatar.animate(pose, 1, dt, performance.now());
  }
  if (frameNo % 120 === 0 && latestPlayers.length) syncRemotes(latestPlayers);

  // carousel music by proximity
  const lp = mode === "ride" ? tmpPos : me.pos;
  const dCar = Math.hypot(lp.x - carousel.center.x, lp.z - carousel.center.z);
  sfx.setMusic(joined ? Math.max(0, Math.min(1, 1 - (dCar - 6) / 35)) : 0);

  // where am I
  if (joined && frameNo % 15 === 0) {
    const pl = places.find((p) => Math.hypot(lp.x - p.x, lp.z - p.z) < p.r);
    setText("where", "📍 " + (pl ? pl.n.replace(/^\S+\s/, (m) => m) : "🌳 Công viên"));
    if (frameNo % 30 === 0) drawMinimap();
  }

  // shadows follow the action
  focus.set(Math.round(focus.x / 2) * 2, 0, Math.round(focus.z / 2) * 2);
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(SUN_OFFSET);
  park.sky.position.copy(camera.position);

  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 200));
document.addEventListener("gesturestart", (e) => e.preventDefault());

if (import.meta.env.DEV) {
  (window as any).__game = {
    me, coaster, wheel, carousel, darts, serverNow, interact, toggleCam,
    get mode() { return mode; },
    get ride() { return myRide; },
    tp(x: number, z: number) { me.pos.set(x, 0, z); },
    setCam(m: "fp" | "tp", yaw?: number, pitch?: number) { camMode = m; if (yaw !== undefined) { camYaw = yaw; rideLookYaw = 0; } if (pitch !== undefined) { camPitch = pitch; rideLookPitch = pitch; } },
  };
}
