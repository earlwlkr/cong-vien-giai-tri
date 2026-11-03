import "./style.css";
import * as THREE from "three";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Avatar, Pose, HIP_HEIGHT, EYE_HEIGHT, EYE_OFFSET } from "./avatar";
import { CharacterMaker } from "./maker";
import { Look, lookFromSeed, lookKey, randomLook } from "../convex/looks";
import { Input } from "./input";
import { Sfx } from "./audio";
import { isTouch, damp, dampAngle, BoxCollider, Collider } from "./util";
import { Coaster, SEATS } from "./world/coaster";
import { FerrisWheel } from "./world/ferris";
import { Carousel } from "./world/carousel";
import { Darts } from "./world/darts";
import { buildPark, BOUNDS, PATHS, PLAZA_R } from "./world/park";
import { drawSprite, hydrateSprites, isSprite, setRich, spriteEl, spriteURL } from "./sprites";
import { Vendors } from "./world/vendors";
import { PixelSprite, pixelImg, pixelSprite } from "./pixel";
import { makeItem } from "./items";
import { CARTS, Cart, XU_QUOTA, XU_REFILL_MS, getItem, isDrink } from "../convex/catalog";

hydrateSprites();
(document.querySelector("link[rel=icon]") as HTMLLinkElement | null)?.setAttribute("href", spriteURL("coaster"));

type Ride = { kind: string; key: string; seat: number; start: number };
type Held = { item: string; left: number };
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
  held: Held | null;
  look: Look | null;
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
const vendors = new Vendors();
scene.add(vendors.group);
const colliders: Collider[] = [...park.colliders, ...coaster.colliders, ...wheel.colliders, ...carousel.colliders, ...vendors.colliders];
const boxes: BoxCollider[] = [...park.boxes, ...darts.boxes];

type ZoneId = "coaster" | "wheel" | "carousel" | "darts";
const zones: { id: ZoneId; x: number; z: number; r: number }[] = [
  { id: "coaster", x: coaster.boardZone.x, z: coaster.boardZone.z, r: 7 },
  { id: "wheel", x: wheel.boardZone.x, z: wheel.boardZone.z, r: 5 },
  { id: "carousel", x: carousel.center.x, z: carousel.center.z, r: 11.5 },
  { id: "darts", x: darts.standPoint.x, z: darts.standPoint.z + 0.8, r: 3.4 },
];
const places = [
  { n: "{gate} Cổng chính", x: 0, z: 92, r: 14 },
  { n: "{fountain} Quảng trường", x: 0, z: 0, r: 24 },
  { n: "{coaster} Tàu lượn siêu tốc", x: -90, z: -95, r: 22 },
  { n: "{wheel} Vòng quay mặt trời", x: 70, z: -66, r: 24 },
  { n: "{horse} Vòng ngựa gỗ", x: 58, z: 18, r: 17 },
  { n: "{target} Ném phi tiêu", x: -52, z: 19, r: 12 },
  { n: "{icecream} Phố ẩm thực", x: 0, z: 52, r: 22 },
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
let myLook: Look = randomLook();
let editing = false;
let myAvatar: Avatar | null = null;
let camMode: "tp" | "fp" = "tp";
let camYaw = Math.PI, camPitch = -0.22, camDist = 6;
let rideLookYaw = 0, rideLookPitch = -0.1;
let myRide: Ride | null = null;
let boardingPending = false;
let mode: "walk" | "ride" | "darts" = "walk";
let coasterQueued = false;
let fov = 70;
let myHeld: Held | null = null;
let usePending = false;
let nextUse = 0;
let shopCart: Cart | null = null;
let buyPending = false;
const shopCamPos = new THREE.Vector3(), shopCamLook = new THREE.Vector3(), shopCamFrom = new THREE.Vector3();
let shopCamActive = false;

// ---------------- Xu wallet (per device; refills every 6h) ----------------
const WALLET_KEY = "cvgt-wallet";
let walletToken = localStorage.getItem(WALLET_KEY) || "";
/** The same token identifies the device's saved profile (name, look, last position). */
const returning = /^[A-Za-z0-9-]{16,64}$/.test(walletToken);
if (!returning) {
  walletToken = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(WALLET_KEY, walletToken);
}
let wallet: { balance: number; cycleStart: number } | null = null;
let refillRequested = false;
function xu(now = serverNow()) {
  if (!wallet) return null;
  return wallet.balance < XU_QUOTA && now - wallet.cycleStart >= XU_REFILL_MS ? XU_QUOTA : wallet.balance;
}
function refillLeft(now = serverNow()) {
  if (!wallet || wallet.balance >= XU_QUOTA) return 0;
  return Math.max(0, wallet.cycleStart + XU_REFILL_MS - now);
}
function fmtDur(ms: number) {
  const m = Math.ceil(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}g${String(m % 60).padStart(2, "0")}p` : `${m}p`;
}
function renderWallet() {
  const now = serverNow();
  const b = xu(now);
  setText("xuVal", b === null ? "…" : String(b));
  const left = refillLeft(now);
  setText("xuRefill", left > 0 ? `· nạp lại sau ${fmtDur(left)}` : "");
  // a refill came due while playing: let the server apply it so the balance is real
  if (wallet && wallet.balance < XU_QUOTA && left === 0 && !refillRequested && client) {
    refillRequested = true;
    client.mutation(api.shop.open, { token: walletToken }).then((w) => (wallet = w)).catch(() => {}).finally(() => (refillRequested = false));
  }
}

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
  held: Held | null;
  name: string;
  color: string;
  lookKey: string;
  sprite: PixelSprite | null;
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
    const look = p.look ?? lookFromSeed(p._id + p.color);
    if (r && (r.name !== p.name || r.color !== p.color || r.lookKey !== lookKey(look))) {
      r.avatar.dispose();
      remotes.delete(p._id);
      r = undefined;
    }
    if (!r) {
      const avatar = new Avatar(p.name, p.color, look);
      scene.add(avatar.group);
      r = { avatar, pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(), yaw: p.ry, targetYaw: p.ry, anim: p.anim, ride: null, held: p.held, name: p.name, color: p.color, lookKey: lookKey(look), sprite: pixelSprite(p.color, look) };
      remotes.set(p._id, r);
    }
    const prev = r.held, held = p.held ?? null;
    if (held && prev?.item === held.item && held.left < prev.left) {
      // they took a bite / sip
      const it = getItem(held.item);
      r.avatar.eat(performance.now());
      if (it) r.avatar.puff(isDrink(it) ? "ực ực!" : "măm măm!", performance.now());
    } else if (!held && prev && getItem(prev.item)?.model !== "balloon") {
      r.avatar.eat(performance.now());
    } else if (held && (prev?.item !== held.item || held.left > prev.left) && !p.ride) {
      // fresh purchase: the nearby seller hands it over
      const cartId = vendors.nearestCartId(p.x, p.z);
      if (cartId) vendors.serve(cartId, performance.now(), false);
    }
    r.held = held;
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
  setRich($("online"), `{people} ${seen.size + (joined ? 1 : 0)} đang chơi`);
  fillChatPortraits();
  if (playerListOpen) renderPlayerList();
}

// ---------------- pixel portraits ----------------
/** Current look of a player (null if they're not in the park any more). */
function spriteFor(id: string): PixelSprite | null | undefined {
  if (id === myId) return pixelSprite(myColor, myLook);
  const r = remotes.get(id);
  if (r) return r.sprite;
  const p = latestPlayers.find((q) => q._id === id);
  return p ? pixelSprite(p.color, p.look ?? lookFromSeed(p._id + p.color)) : undefined;
}
/** Chat lines whose sender wasn't known yet (chat history can arrive before the player list). */
let pendingPortraits: { id: string; slot: HTMLElement }[] = [];
function fillChatPortraits() {
  pendingPortraits = pendingPortraits.filter(({ id, slot }) => {
    if (!slot.isConnected) return false;
    const s = spriteFor(id);
    if (s) slot.replaceWith(pixelImg(s, "bust", 1));
    return s === undefined;
  });
}

let playerListOpen = false;
const RIDE_NAMES: Record<string, string> = { coaster: "tàu lượn", wheel: "vòng quay", carousel: "ngựa gỗ" };
function renderPlayerList() {
  const el = $("playerList");
  el.innerHTML = "";
  const now = serverNow();
  const entries: { id: string; name: string; me: boolean; note: string }[] = [{ id: myId ?? "", name: myName, me: true, note: "bạn" }];
  for (const p of latestPlayers) {
    if (p._id === myId || now - p.lastSeen > 20000) continue;
    entries.push({ id: p._id, name: p.name, me: false, note: p.ride ? "đang chơi " + (RIDE_NAMES[p.ride.kind] ?? p.ride.kind) : "" });
  }
  for (const e of entries) {
    const card = document.createElement("div");
    card.className = "pl" + (e.me ? " me" : "");
    const s = e.me ? pixelSprite(myColor, myLook) : spriteFor(e.id);
    if (s) card.appendChild(pixelImg(s, "full", 2));
    const nm = document.createElement("span");
    nm.textContent = e.name;
    card.appendChild(nm);
    if (e.note) {
      const sm = document.createElement("small");
      sm.textContent = e.note;
      card.appendChild(sm);
    }
    el.appendChild(card);
  }
}
function togglePlayerList(on = !playerListOpen) {
  playerListOpen = on;
  show("playerList", on);
  if (on) renderPlayerList();
}
$("online").addEventListener("click", () => togglePlayerList());

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
  myHeld = null;
  const r = await client.mutation(api.players.join, { token: walletToken, fallback: spawnPoint(), at: { x: me.pos.x, z: me.pos.z, ry: me.yaw } });
  if (r) myId = r.id;
}

// ---------------- chat ----------------
const chatLog = $("chatLog");
const chatForm = $("chatForm") as HTMLFormElement;
const chatInput = $("chatInput") as HTMLInputElement;
const seenMsgs = new Set<string>();
let firstChat = true;
function addChatLine(name: string | null, color: string, text: string, rich = false, playerId?: string) {
  const d = document.createElement("div");
  d.className = "msg" + (name ? "" : " sys");
  if (playerId) {
    const s = spriteFor(playerId);
    if (s) d.appendChild(pixelImg(s, "bust", 1));
    else if (s === undefined) {
      const slot = document.createElement("span");
      d.appendChild(slot);
      pendingPortraits.push({ id: playerId, slot });
    }
  }
  if (name) {
    const b = document.createElement("b");
    b.style.color = color;
    b.textContent = name + ":";
    d.appendChild(b);
  }
  if (rich) {
    const span = document.createElement("span");
    setRich(span, text);
    d.appendChild(span);
  } else d.appendChild(document.createTextNode(text));
  chatLog.appendChild(d);
  while (chatLog.children.length > 40) chatLog.firstElementChild!.remove();
  setTimeout(() => d.classList.add("old"), 12000);
}
function openChat() {
  if (!joined || editing) return;
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
  setRich(el, t);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), ms);
}
const setText = (() => {
  const cache = new Map<string, string>();
  return (id: string, text: string) => {
    if (cache.get(id) === text) return;
    cache.set(id, text);
    setRich($(id), text);
  };
})();
const show = (id: string, on: boolean) => $(id).classList.toggle("hidden", !on);

function toggleCam() {
  camMode = camMode === "tp" ? "fp" : "tp";
  if (camMode === "fp") camPitch = Math.max(-0.6, Math.min(0.3, camPitch + 0.15));
  else camPitch = Math.min(camPitch, -0.15);
  rideLookPitch = camMode === "fp" ? -0.05 : -0.42;
  toast(camMode === "fp" ? "{eye} Góc nhìn thứ nhất" : "{camera} Góc nhìn thứ ba", 1200);
}
$("camBtn").addEventListener("click", toggleCam);
$("soundBtn").addEventListener("click", () => {
  sfx.init();
  setRich($("soundBtn"), sfx.toggle() ? "{sound}" : "{mute}");
});
$("jumpBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  input.jumpQueued = true;
});
$("exitBtn").addEventListener("click", () => leaveActivity());
$("prompt").addEventListener("click", () => interact());
$("useBtn").addEventListener("click", () => useHeld());
$("shopClose").addEventListener("click", () => closeShop());
const EXIT_LABEL = isTouch ? "{back} Rời trò chơi" : "{back} Rời trò chơi (Q)";
const EXIT_LABEL_RIDE = isTouch ? "{back} Xuống" : "{back} Xuống (Q)";
setRich($("exitBtn"), EXIT_LABEL);
/** On a ride: hide everything that isn't needed while seated (minimap, location, jump, etc). */
function setRidingUI(on: boolean) {
  document.body.classList.toggle("riding", on);
  // Seated: stack the exit button in the top-left column (players, ride status, exit) so nothing overlaps.
  (on ? $("topLeft") : $("ui")).appendChild($("exitBtn"));
  setRich($("exitBtn"), on ? EXIT_LABEL_RIDE : EXIT_LABEL);
}

input.onKey = (code) => {
  if (!joined) return;
  if (editing) {
    if (code === "Escape") closeEditor();
    return;
  }
  if (shopCart) {
    if (code === "Escape" || code === "KeyQ" || code === "KeyE") closeShop();
    else if (/^(Digit|Numpad)[1-9]$/.test(code)) {
      const id = shopCart.items[+code.slice(-1) - 1];
      if (id) buy(id);
    }
    return;
  }
  if (code === "KeyF") useHeld();
  else if (code === "KeyV") toggleCam();
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
      toast("Hết chỗ rồi, thử lại sau nhé!");
      return;
    }
    myRide = r;
    mode = "ride";
    rideLookYaw = 0;
    rideLookPitch = camMode === "fp" ? -0.05 : -0.42;
    input.resetStick();
    sfx.chime();
    setRidingUI(true);
    show("exitBtn", true);
    show("prompt", false);
    show("board", false);
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
    if (coasterQueued) toast("{hourglass} Đã xếp hàng! Tàu tới là lên ngay", 1800);
    return;
  }
  coasterQueued = false;
  doBoard("coaster", st.key, SEATS, st.cycleStart);
}

function interact() {
  if (!joined || mode !== "walk") return;
  const z = currentZone();
  if (!z) {
    const cart = vendors.at(me.pos.x, me.pos.z);
    if (cart) {
      sfx.init();
      openShop(cart);
    }
    return;
  }
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
    if (i < 0) toast("{horse} Hết ngựa rồi!");
    else doBoard("carousel", `carousel:${i}`, 1, now);
  } else if (z.id === "darts") startDarts();
}

// ---------------- food carts ----------------
const cartName = (c: Cart) => c.title.charAt(0) + c.title.slice(1).toLowerCase();
const itemVerb = (id: string) => {
  const it = getItem(id);
  return !it ? "" : it.model === "balloon" ? "Thả bóng" : isDrink(it) ? "Uống" : "Ăn";
};

function openShop(c: Cart) {
  shopCart = c;
  input.resetStick();
  closeChat();
  const line = vendors.greet(c.id, performance.now());
  const head = $("shop").querySelector(".shopHead") as HTMLElement;
  head.style.background = `linear-gradient(90deg, ${c.color}, #ff9f1c)`;
  setRich($("shopTitle"), `{${c.sprite}} ${cartName(c)}`);
  const sel = $("shopSeller");
  sel.replaceChildren();
  const b = document.createElement("b");
  b.textContent = c.seller.name + ": ";
  sel.append(b, `“${line}”`);
  renderShop();
  document.body.classList.add("shopping");
  show("shop", true);
  show("prompt", false);
  sfx.chime();
}
function closeShop() {
  if (!shopCart) return;
  shopCart = null;
  shopCamActive = false;
  document.body.classList.remove("shopping");
  show("shop", false);
}
function renderShop() {
  const c = shopCart;
  if (!c) return;
  const bal = xu();
  const list = $("shopItems");
  list.replaceChildren();
  c.items.forEach((id, i) => {
    const it = getItem(id)!;
    const row = document.createElement("div");
    row.className = "shopItem";
    const info = document.createElement("div");
    const nm = document.createElement("div");
    nm.className = "nm";
    if (!isTouch) {
      const k = document.createElement("kbd");
      k.textContent = String(i + 1);
      nm.append(k);
    }
    nm.append(it.name);
    const ds = document.createElement("div");
    ds.className = "ds";
    ds.textContent = it.desc;
    info.append(nm, ds);
    const btn = document.createElement("button");
    setRich(btn, `${it.price} {coin}`);
    btn.disabled = buyPending || bal === null || bal < it.price;
    btn.title = bal !== null && bal < it.price ? "Không đủ Xu" : `Mua ${it.name}`;
    btn.onclick = () => buy(id);
    row.append(isSprite(it.sprite) ? spriteEl(it.sprite) : document.createElement("span"), info, btn);
    list.append(row);
  });
  const foot = $("shopWallet");
  setRich(foot, `Bạn có {coin} `);
  const bb = document.createElement("b");
  bb.textContent = bal === null ? "…" : `${bal} Xu`;
  foot.append(bb);
  const left = refillLeft();
  const holding = myHeld && getItem(myHeld.item);
  $("shopNote").textContent = holding
    ? `Đang cầm ${holding.name} – mua món mới sẽ thay`
    : left > 0 ? `Nạp lại ${XU_QUOTA} Xu sau ${fmtDur(left)}` : `Mỗi 6 giờ nạp lại ${XU_QUOTA} Xu`;
}

async function buy(id: string) {
  const c = shopCart;
  const it = getItem(id);
  if (!c || !it || !client || !myId || buyPending) return;
  const bal = xu();
  if (bal !== null && bal < it.price) {
    toast(`{coin} Không đủ Xu! Còn ${bal} Xu, nạp lại sau ${fmtDur(refillLeft())}`, 3200);
    return;
  }
  buyPending = true;
  renderShop();
  try {
    // make sure the server has our position at the counter
    await client.mutation(api.players.update, { id: myId, x: me.pos.x, y: me.pos.y, z: me.pos.z, ry: me.yaw, anim: me.pose });
    const r = await client.mutation(api.shop.buy, { id: myId, token: walletToken, cart: c.id, item: id });
    if (r.ok) {
      wallet = { balance: r.balance, cycleStart: r.cycleStart };
      if (myHeld && myAvatar?.heldObject?.userData.balloon) vendors.releaseBalloon(myAvatar.heldObject, scene);
      myHeld = { item: id, left: it.bites };
      sfx.coin();
      vendors.serve(c.id, performance.now());
      $("wallet").classList.remove("bump");
      void $("wallet").offsetWidth;
      $("wallet").classList.add("bump");
      closeShop();
      const how = isTouch ? `Bấm nút ${itemVerb(id)}` : `Bấm F để ${itemVerb(id).toLowerCase()}`;
      toast(`{${it.sprite}} ${it.name} – ${it.price} Xu. ${it.model === "balloon" ? "Cầm chặt nha!" : how + "!"}`, 3000);
    } else if (r.reason === "poor") {
      if (r.balance !== undefined && wallet) wallet.balance = r.balance;
      toast(`{coin} Không đủ Xu! Đợi nạp lại sau ${fmtDur(refillLeft())} nhé`, 3200);
    } else if (r.reason === "far") toast("Lại gần quầy hơn chút nhé!");
    else if (r.reason === "player") rejoin();
  } catch {
    toast("Lỗi kết nối, thử lại nhé");
  } finally {
    buyPending = false;
    renderShop();
  }
}

function useHeld() {
  if (!joined || !myHeld || !client || !myId || usePending || mode === "darts" || shopCart) return;
  const t = performance.now();
  if (t < nextUse) return;
  const it = getItem(myHeld.item);
  if (!it) return;
  sfx.init();
  usePending = true;
  const balloon = it.model === "balloon";
  if (!balloon) {
    nextUse = t + 900;
    myAvatar?.eat(t);
    if (isDrink(it)) sfx.slurp();
    else sfx.munch();
    myAvatar?.puff(isDrink(it) ? "ực ực!" : "măm măm!", t);
  } else if (myAvatar?.heldObject) {
    vendors.releaseBalloon(myAvatar.heldObject, scene);
    sfx.whoosh();
  }
  const left = myHeld.left - 1;
  myHeld = left > 0 ? { item: myHeld.item, left } : null;
  if (!myHeld) {
    setTimeout(() => {
      if (balloon) toast("{balloon} Bóng bay lên trời rồi… tạm biệt!", 2600);
      else toast(isDrink(it) ? `{drink} Đã khát quá! Hết ${it.name} rồi.` : `{party} Ngon quá! Hết sạch ${it.name}.`, 2600);
      if (!balloon) sfx.ding();
    }, balloon ? 400 : 900);
  }
  client
    .mutation(api.shop.use, { id: myId })
    .then((r) => {
      // server is the source of truth (e.g. after a reconnect)
      if (!r) myHeld = null;
      else myHeld = r.left > 0 ? { item: r.item, left: r.left } : null;
    })
    .catch(() => {})
    .finally(() => (usePending = false));
}

/** Rebuilds the hand-held model when the item or its remaining bites change. */
function showHeld(a: Avatar, held: Held | null) {
  const key = held ? `${held.item}:${held.left}` : "";
  if (a.heldKey === key) return;
  const prev = a.heldObject;
  if (prev?.userData.balloon && (!held || !key.startsWith(a.heldKey.split(":")[0] + ":"))) vendors.releaseBalloon(prev, scene);
  const obj = held ? makeItem(held.item, held.left) : null;
  obj?.scale.multiplyScalar(1.35);
  a.setHeld(obj, key);
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
  setRidingUI(false);
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
  closeShop();
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
    toast(`{timer} Hết giờ! Bạn được ${score} điểm {target}`, 3500);
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
  setRich(h, "{trophy} Bảng vàng Ném Phi Tiêu");
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

// ---------------- join / character ----------------
const maker = new CharacterMaker();
if (import.meta.env.DEV) (window as any).__maker = maker;
const joinEl = $("join");
const joinBtn = $("joinBtn") as HTMLButtonElement;
const nameInput = $("nameInput") as HTMLInputElement;
function setJoinMode(m: "first" | "edit" | "resume") {
  joinEl.classList.remove("mode-first", "mode-edit", "mode-resume");
  joinEl.classList.add("mode-" + m);
  maker.setActive(m !== "resume");
  setRich(joinBtn, m === "edit" ? "Lưu {star}" : "Vào công viên {play}");
  joinBtn.disabled = false;
  $("joinStatus").textContent = "";
}
const spawnPoint = () => ({ x: (Math.random() - 0.5) * 6, z: 84 + Math.random() * 4 });
// browsers only allow sound after a tap / key press; returning players skip the join button
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => sfx.init(), { once: true, capture: true });

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitMaker();
  else if (e.key === "Escape" && editing) closeEditor();
});
joinBtn.addEventListener("click", () => submitMaker());
$("cancelBtn").addEventListener("click", () => closeEditor());
$("retryBtn").addEventListener("click", () => resume());
$("editBtn").addEventListener("click", () => openEditor());

function openEditor() {
  if (!joined || editing) return;
  if (shopCart) closeShop();
  editing = true;
  maker.set({ name: myName, color: myColor, look: myLook });
  setJoinMode("edit");
  show("join", true);
}
function closeEditor() {
  if (!editing) return;
  editing = false;
  show("join", false);
  maker.setActive(false);
  (document.activeElement as HTMLElement | null)?.blur?.();
}

function setMyAvatar() {
  myAvatar?.dispose();
  myAvatar = new Avatar(myName, myColor, myLook);
  scene.add(myAvatar.group);
  if (playerListOpen) renderPlayerList();
}

async function connect() {
  if (client) return client;
  const c = new ConvexClient(CONVEX_URL!);
  await (client = c, syncTime()).catch((e) => {
    client = null;
    c.close();
    throw e;
  });
  return c;
}

/** Saves the form as the device's profile, then enters the park (or applies the edit). */
async function submitMaker() {
  if (joinBtn.disabled) return;
  if (!CONVEX_URL) {
    $("joinStatus").textContent = "Thiếu cấu hình máy chủ (VITE_CONVEX_URL).";
    return;
  }
  const ch = maker.value();
  if (!ch.name) ch.name = editing ? myName : "Khách " + Math.floor(100 + Math.random() * 900);
  joinBtn.disabled = true;
  $("joinStatus").textContent = "";
  joinBtn.textContent = editing ? "Đang lưu…" : "Đang kết nối…";
  try {
    const c = await connect();
    const saved = await c.mutation(api.players.saveProfile, { token: walletToken, ...ch, id: editing && myId ? myId : undefined });
    localStorage.setItem("cvgt-name", saved.name);
    localStorage.setItem("cvgt-color", saved.color);
    if (editing) {
      const renamed = saved.name !== myName;
      myName = saved.name;
      myColor = saved.color;
      myLook = saved.look as Look;
      setMyAvatar();
      closeEditor();
      toast(renamed ? `{star} Đã đổi tên thành ${myName}` : "{star} Đã lưu nhân vật", 2000);
      return;
    }
    if (!(await enter())) throw new Error("profile missing after save");
  } catch (e) {
    console.error(e);
    $("joinStatus").textContent = editing ? "Không lưu được. Thử lại nhé!" : "Không kết nối được máy chủ. Thử lại nhé!";
    joinBtn.disabled = false;
    setRich(joinBtn, editing ? "Lưu {star}" : "Vào công viên {play}");
  }
}

/** Returning device: go straight back in where the player left, no menu. */
async function resume() {
  setJoinMode("resume");
  $("resumeMsg").textContent = "Đang vào lại công viên…";
  show("retryBtn", false);
  try {
    await connect();
    if (await enter()) return;
    // no saved profile yet (played before profiles existed): pick a character once
    maker.set({ name: localStorage.getItem("cvgt-name") || "", color: localStorage.getItem("cvgt-color") || undefined });
    setJoinMode("first");
  } catch (e) {
    console.error(e);
    $("resumeMsg").textContent = "Không kết nối được máy chủ.";
    show("retryBtn", true);
  }
}

let sessionStarted = false;
function startSession(c: ConvexClient) {
  if (sessionStarted) return;
  sessionStarted = true;
  c.onUpdate(api.shop.wallet, { token: walletToken }, (w) => {
    if (!w) return;
    wallet = w;
    renderWallet();
    if (shopCart && !buyPending) renderShop();
  });
  c.onUpdate(api.players.list, {}, (list) => syncRemotes(list as PlayerDoc[]));
  c.onUpdate(api.chat.recent, {}, (msgs) => {
    const now = serverNow();
    for (const m of msgs) {
      if (seenMsgs.has(m._id)) continue;
      seenMsgs.add(m._id);
      addChatLine(m.name, m.color, m.text, false, m.playerId);
      if (!firstChat && now - m._creationTime < 20000) {
        if (m.playerId === myId) myAvatar?.say(m.text, performance.now());
        else remotes.get(m.playerId)?.avatar.say(m.text, performance.now());
        if (m.playerId !== myId) sfx.chime();
      }
    }
    firstChat = false;
  });
  c.onUpdate(api.scores.top, { game: "darts" }, (s) => {
    topScores = s;
    renderBoard();
  });
  setInterval(() => syncTime().catch(() => {}), 60000);
}

/** Joins as the saved profile. Returns false if this device has none yet. */
async function enter() {
  const c = await connect();
  const r = await c.mutation(api.players.join, { token: walletToken, fallback: spawnPoint() });
  if (!r) return false;
  wallet = await c.mutation(api.shop.open, { token: walletToken });
  myId = r.id;
  myName = r.name;
  myColor = r.color;
  myLook = r.look as Look;
  me.pos.set(r.x, 0, r.z);
  collide(me.pos);
  me.yaw = r.ry;
  camYaw = r.ry;
  camPitch = -0.2;
  setMyAvatar();
  joined = true;
  startSession(c);
  show("join", false);
  maker.setActive(false);
  show("ui", true);
  if (r.resumed) addChatLine(null, "", `Chào mừng ${myName} quay lại! {party} Bạn đang ở chỗ lần trước rời công viên.`, true);
  else addChatLine(null, "", `Chào mừng ${myName} đến Công Viên Giải Trí! {party} Hãy thử tàu lượn siêu tốc ở phía Tây Bắc nhé.`, true);
  addChatLine(null, "", `{coin} Bạn có ${xu() ?? XU_QUOTA} Xu để mua đồ ăn, nước uống ở các xe đẩy – tự nạp lại sau 6 giờ.`, true);
  addChatLine(null, "", "{pencil} Bấm nút bút chì ở góc trên để đổi tên hoặc nhân vật.", true);
  toast(isTouch ? "Kéo bên trái để đi, bên phải để nhìn" : "WASD để đi · kéo chuột để nhìn · V đổi góc nhìn", 4000);
  return true;
}

if (returning && CONVEX_URL) resume();
else {
  maker.set({ name: localStorage.getItem("cvgt-name") || "", color: localStorage.getItem("cvgt-color") || undefined });
  setJoinMode("first");
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
  for (const c of CARTS) if (isSprite(c.sprite)) drawSprite(g, c.sprite, ...toMap(c.x, c.z), 10);
  for (const [e, x, z] of [["coaster", -92, -92], ["wheel", 70, -70], ["horse", 58, 18], ["target", -52, 16], ["fountain", 0, 0], ["gate", 0, 96]] as const) drawSprite(g, e, ...toMap(x, z), 16);
}
const MM_HEAD = 14;
function drawMinimap() {
  mmCtx.drawImage(mmBg, 0, 0);
  const now = serverNow();
  for (const r of remotes.values()) {
    const p = r.avatar.group.position;
    const [x, y] = toMap(p.x, p.z);
    if (r.sprite) {
      mmCtx.drawImage(r.sprite.bust, Math.round(x - MM_HEAD / 2), Math.round(y - MM_HEAD / 2), MM_HEAD, MM_HEAD);
      continue;
    }
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

    const frozen = !!shopCart || editing;
    if (editing) input.jumpQueued = false;
    const mv = frozen ? { x: 0, y: 0, run: false } : input.move();
    const speed = mv.run ? 8.5 : 4.6;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const tx = (fx * mv.y + rx * mv.x) * speed, tz = (fz * mv.y + rz * mv.x) * speed;
    const accel = me.onGround ? 12 : 3;
    me.vel.x = damp(me.vel.x, tx, accel, dt);
    me.vel.z = damp(me.vel.z, tz, accel, dt);
    if (input.consumeJump() && me.onGround && !shopCart) {
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
    if (shopCart) { /* yaw handled by the shop camera */ }
    else if (camMode === "fp") me.yaw = camYaw;
    else if (hs > 0.3) me.yaw = dampAngle(me.yaw, Math.atan2(me.vel.x, me.vel.z), 12, dt);
    me.pose = !me.onGround ? "jump" : hs > 6 ? "run" : hs > 0.4 ? "walk" : "idle";

    // camera
    lookDir.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
    camera.up.copy(UP);
    if (shopCart && vendors.shopView(shopCart.id, shopCamPos, shopCamLook)) {
      // face the counter and frame the seller
      me.yaw = dampAngle(me.yaw, Math.atan2(shopCart.x - me.pos.x, shopCart.z - me.pos.z), 10, dt);
      if (!shopCamActive) {
        shopCamFrom.copy(camera.position);
        shopCamActive = true;
      }
      shopCamFrom.lerp(shopCamPos, 1 - Math.exp(-dt * 5));
      camera.position.copy(shopCamFrom);
      camera.lookAt(shopCamLook);
    } else if (camMode === "fp") {
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
      myAvatar.setFirstPerson(camMode === "fp" && !shopCart);
      myAvatar.group.visible = true;
      if (shopCart) myAvatar.label.visible = false;
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
          label = `{hourglass} Đang chờ tàu… ${Math.ceil(coaster.nextBoarding(now))}s (bấm để hủy)`;
        } else if (st) label = `{coaster} Lên tàu lượn! Tàu chạy sau ${Math.ceil(st.dwellLeft)}s${isTouch ? "" : " (E)"}`;
        else label = `{coaster} Xếp hàng chờ tàu – ${Math.ceil(coaster.nextBoarding(now))}s${isTouch ? "" : " (E)"}`;
      } else if (z.id === "wheel") label = `{wheel} Lên vòng quay mặt trời${isTouch ? "" : " (E)"}`;
      else if (z.id === "carousel") label = `{horse} Cưỡi ngựa gỗ${isTouch ? "" : " (E)"}`;
      else label = `{target} Chơi ném phi tiêu${isTouch ? "" : " (E)"}`;
      setText("prompt", label);
    }
    const cart = !z && !shopCart ? vendors.at(me.pos.x, me.pos.z) : null;
    if (cart) setText("prompt", `{${cart.sprite}} Mua ${cartName(cart)}${isTouch ? "" : " (E)"}`);
    if (shopCart && !vendors.at(me.pos.x, me.pos.z)) closeShop();
    show("prompt", (!!z || !!cart) && !shopCart);
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
      if (wasCoaster) toast("{party} Tuyệt vời! Bạn đã chinh phục tàu lượn siêu tốc!", 3500);
      else if (wasWheel) toast("{wheel} Hết một vòng – cảnh đẹp không?", 3000);
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
          setText("rideHud", `{lock} Khởi hành sau ${Math.ceil(waiting)}s`);
          show("rideHud", true);
          show("speedo", false);
        } else {
          if (lastWaiting > 0) { sfx.ding(); toast("{rocket} Xuất phát!", 1500); }
          show("rideHud", !!res.lift);
          if (res.lift) setText("rideHud", "{chain} Lên dốc 30m…");
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
        setText("rideHud", `{wheel} ${Math.max(0, res.height ?? 0).toFixed(0)} m · ${Math.ceil(res.left ?? 0)}s`);
        show("rideHud", true);
        sfx.setWind(Math.max(0, ((res.height ?? 0) - 15) / 40));
      } else {
        show("rideHud", false);
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

  // food carts, things in hand, wallet
  vendors.update(t, dt, performance.now(), joined && mode !== "ride" ? me.pos : null);
  if (myAvatar) showHeld(myAvatar, myHeld);
  if (joined) {
    const canUse = !!myHeld && mode !== "darts" && !shopCart;
    if (canUse && myHeld) {
      const it = getItem(myHeld.item);
      const dots = it && it.bites > 1 ? " " + "●".repeat(myHeld.left) + "○".repeat(Math.max(0, it.bites - myHeld.left)) : "";
      setText("useBtn", `{${it?.sprite ?? "party"}} ${itemVerb(myHeld.item)}${isTouch ? "" : " (F)"}${dots}`);
    }
    show("useBtn", canUse);
    if (frameNo % 30 === 0) renderWallet();
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
    showHeld(r.avatar, r.held);
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
    setText("where", pl ? pl.n : "{tree} Công viên");
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
    get held() { return myHeld; },
    get wallet() { return wallet; },
    vendors, openShop: (i: number) => openShop(CARTS[i]), buy, useHeld,
    tp(x: number, z: number) { me.pos.set(x, 0, z); },
    setCam(m: "fp" | "tp", yaw?: number, pitch?: number) { camMode = m; if (yaw !== undefined) { camYaw = yaw; rideLookYaw = 0; } if (pitch !== undefined) { camPitch = pitch; rideLookPitch = pitch; } },
  };
}
