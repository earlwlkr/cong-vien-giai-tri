import "./style.css";
import * as THREE from "three";
import { ConvexClient } from "convex/browser";
import { inject as injectAnalytics } from "@vercel/analytics";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Avatar, Pose, HIP_HEIGHT, EYE_HEIGHT, EYE_OFFSET } from "./avatar";
import { CharacterMaker } from "./maker";
import { Look, lookFromSeed, lookKey, randomLook } from "../convex/looks";
import { Input } from "./input";
import { Sfx } from "./audio";
import { isTouch, damp, dampAngle, BoxCollider, Collider } from "./util";
import { Darts } from "./world/darts";
import { buildRides, type Ride, type RideDef, type RideEnv, type RideResult } from "./rides";
import { keyIndex } from "./rides/types";
import { buildPark, BOUNDS, PATHS, PLAZA_R } from "./world/park";
import { drawSprite, hydrateSprites, isSprite, setRich, spriteEl, spriteURL } from "./sprites";
import { Vendors } from "./world/vendors";
import { Fountain, WISHES } from "./world/fountain";
import { makeItem } from "./items";
import { REACTIONS, REACT_GAP_MS, REACT_STREAM_MS, parseAnim, reactionSprite } from "./reactions";
import { CARTS, Cart, WISH_LUCKY_XU, WISH_PRICE, XU_QUOTA, XU_REFILL_MS, cartFront, getItem, isDrink } from "../convex/catalog";

hydrateSprites();
(document.querySelector("link[rel=icon]") as HTMLLinkElement | null)?.setAttribute("href", spriteURL("coaster"));

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
/** players.list row: who someone is and what they're doing (rarely changes). */
type RosterDoc = Omit<PlayerDoc, "x" | "y" | "z" | "ry" | "anim" | "lastSeen">;
/** players.positions row: where they are (the 110 ms stream). */
type PosDoc = { p: Id<"players">; x: number; y: number; z: number; ry: number; anim: string; t: number };

const $ = (id: string) => document.getElementById(id)!;
if (isTouch) document.body.classList.add("touch");
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;

// Vercel Web Analytics (page views / visitors / referrers). Deployed builds only: the script is
// served by Vercel at /_vercel/insights, so dev, e2e and `vite preview` skip it.
if (import.meta.env.PROD && !/^(localhost|127\.|\[::1\])/.test(location.hostname)) injectAnalytics({ framework: "vite" });

// ---------------- renderer / scene ----------------
const canvas = $("game") as HTMLCanvasElement;
/** `?lowgfx`: no shadows, no antialiasing, 1x pixels. For headless tests (software GL is slow) and weak devices. */
const lowGfx = new URLSearchParams(location.search).has("lowgfx");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx && (!isTouch || devicePixelRatio < 2), powerPreference: "high-performance" });
renderer.setPixelRatio(lowGfx ? 1 : Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !lowGfx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1500);
const hemi = new THREE.HemisphereLight("#d6ecff", "#5d7d3a", 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff1d6", 2.6);
sun.castShadow = !lowGfx;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
const SUN_OFFSET = new THREE.Vector3(70, 110, 45);
scene.add(sun, sun.target);

// ---------------- world ----------------
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
/** What rides get from the game (see src/rides/types.ts). */
const rideEnv: RideEnv = {
  sfx,
  input,
  isTouch,
  me,
  serverNow: () => serverNow(),
  toast: (t, ms) => toast(t, ms),
  setText: (id, t) => setText(id, t),
  show: (id, on) => show(id, on),
  shake: (a) => (shake = Math.max(shake, a)),
  myAvatar: () => myAvatar,
  remotes: () => remotes.entries(),
  takenSeats(kind) {
    const now = serverNow(), taken = new Set<number>();
    for (const p of latestPlayers) if (p._id !== myId && p.ride?.kind === kind && now - p.lastSeen < 20000) taken.add(keyIndex(p.ride.key));
    return taken;
  },
};
const rides = buildRides(rideEnv);
for (const r of rides.list) scene.add(r.object);
const rideOf = (kind: string | undefined) => (kind ? rides.byKind.get(kind) : undefined);
const darts = new Darts(-52, 16);
darts.attach(scene);
const dartsTarget = new THREE.Vector3(darts.origin.x, 2.3, darts.origin.z - 3.3);

function blocked(x: number, z: number) {
  if (rides.list.some((r) => r.blocks(x, z))) return true;
  if (Math.abs(x + 52) < 8 && z > 8 && z < 27) return true; // darts
  if (Math.abs(x) < 14 && z > 90) return true; // gate
  return false;
}
const park = buildPark(scene, blocked, isTouch);
const vendors = new Vendors();
scene.add(vendors.group);
const fountain = new Fountain();
scene.add(fountain.group);
const colliders: Collider[] = [...park.colliders, ...fountain.colliders, ...vendors.colliders, ...rides.list.flatMap((r) => r.colliders)];
const boxes: BoxCollider[] = [...park.boxes, ...darts.boxes, ...rides.list.flatMap((r) => r.boxes ?? [])];

/** Where E does something: a ride's boarding area, the darts stand, or the fountain's edge. */
type Zone = { id: string; ride?: RideDef; x: number; z: number; r: number };
const zones: Zone[] = [
  ...rides.list.flatMap((r) => (r.zones ?? [r.zone]).map((z) => ({ id: r.kind, ride: r, ...z }))),
  { id: "darts", x: darts.standPoint.x, z: darts.standPoint.z + 0.8, r: 3.4 },
  { id: "fountain", x: 0, z: 0, r: fountain.reach },
];
const places = [
  { n: "{gate} Cổng chính", x: 0, z: 92, r: 14 },
  { n: "{fountain} Quảng trường", x: 0, z: 0, r: 24 },
  ...rides.list.flatMap((r) => (r.place ? [{ n: r.place.name, x: r.place.x, z: r.place.z, r: r.place.r }] : [])),
  { n: "{target} Ném phi tiêu", x: -52, z: 19, r: 12 },
  { n: "{icecream} Phố ẩm thực", x: 0, z: 52, r: 22 },
];
const music = rides.list.find((r) => r.music)?.music;

// ---------------- state ----------------
let joined = false;
let myId: Id<"players"> | null = null;
/** Our row in `positions`: what players.update writes. */
let myPos: Id<"positions"> | null = null;
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
/** Scheduled ride kind we're queueing for (boards automatically when it arrives). */
let queued: string | null = null;
let shake = 0;
let fov = 70;
let myHeld: Held | null = null;
let usePending = false;
let nextUse = 0;
let shopCart: Cart | null = null;
let buyPending = false;
const shopCamPos = new THREE.Vector3(), shopCamLook = new THREE.Vector3(), shopCamFrom = new THREE.Vector3();
let shopCamActive = false;
/** performance.now() until which we're waving / mid coin toss. */
let waveUntil = 0;
/** Our latest reaction as streamed (`r<kind><n>`), until reactUntil. */
let reactToken = "";
let reactUntil = 0;
let reactCount = 0;
let throwUntil = 0;
let wishPending = false;
/** When we sat down (standOnMove rides ignore the stick for a moment, so a held W doesn't stand you right up). */
let boardedAt = 0;
/** Yaw of our seat last frame: standing up from a bench keeps the view. */
let seatYaw = 0;

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
/** DEV only (__game.warp): pretend time has moved on, so tests don't wait out ride schedules. */
let warpMs = 0;
const serverNow = () => Date.now() + timeOffset + warpMs;
interface Remote {
  avatar: Avatar;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  anim: string;
  /** Last reaction token seen in their anim (a new one floats a sprite). */
  react: string | null;
  ride: Ride | null;
  held: Held | null;
  name: string;
  color: string;
  lookKey: string;
}
const remotes = new Map<string, Remote>();
let latestPlayers: PlayerDoc[] = [];
let roster: RosterDoc[] = [];
let posByPlayer = new Map<string, PosDoc>();
/** Joins the two subscriptions into the PlayerDoc shape the rest of the client uses. */
function mergedPlayers(): PlayerDoc[] {
  const out: PlayerDoc[] = [];
  for (const p of roster) {
    const q = posByPlayer.get(p._id);
    if (q) out.push({ ...p, x: q.x, y: q.y, z: q.z, ry: q.ry, anim: q.anim, lastSeen: q.t });
  }
  return out;
}

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
      r = { avatar, pos: new THREE.Vector3(p.x, p.y, p.z), target: new THREE.Vector3(), yaw: p.ry, targetYaw: p.ry, anim: p.anim, react: null, ride: null, held: p.held, name: p.name, color: p.color, lookKey: lookKey(look) };
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
    const a = parseAnim(p.anim);
    if (p.anim !== r.anim && p.ride) {
      const prev = parseAnim(r.anim).base;
      if (a.base !== prev) rideOf(p.ride.kind)?.remoteAnim?.(r, a.base, prev);
    }
    if (a.react !== r.react) {
      const spr = a.react && reactionSprite(a.react);
      if (spr) {
        r.avatar.react(spr, performance.now());
        if (r.pos.distanceTo(me.pos) < 25) sfx.plip();
      }
      r.react = a.react;
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
  setRich($("online"), `{people} ${seen.size + (joined ? 1 : 0)} đang chơi`);
  if (playerListOpen) renderPlayerList();
}

// ---------------- who's online (click the player count) ----------------
let playerListOpen = false;
function renderPlayerList() {
  const el = $("playerList");
  el.innerHTML = "";
  const now = serverNow();
  const rows = [{ name: myName, color: myColor, me: true, note: "bạn" }];
  const others = latestPlayers
    .filter((p) => p._id !== myId && now - p.lastSeen <= 20000)
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  for (const p of others) rows.push({ name: p.name, color: p.color, me: false, note: rideOf(p.ride?.kind)?.label ?? "" });
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "pl" + (r.me ? " me" : "");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = r.color;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = r.name;
    nm.style.color = r.me ? "#ffd166" : "";
    row.append(dot, nm);
    if (r.note) {
      const sm = document.createElement("small");
      sm.textContent = r.note;
      row.appendChild(sm);
    }
    el.appendChild(row);
  }
  if (!others.length) {
    const row = document.createElement("div");
    row.className = "pl";
    const sm = document.createElement("small");
    sm.style.margin = "0";
    sm.textContent = "Chưa có ai khác – rủ bạn bè vào chơi nhé!";
    row.appendChild(sm);
    el.appendChild(row);
  }
}
function togglePlayerList(on = !playerListOpen) {
  playerListOpen = on;
  show("playerList", on);
  $("online").classList.toggle("open", on);
  if (on) renderPlayerList();
}
$("online").addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlayerList();
  ($("online") as HTMLButtonElement).blur();
});
// tap / click anywhere else closes it
window.addEventListener("pointerdown", (e) => {
  if (playerListOpen && !(e.target as HTMLElement).closest?.("#playerList, #online")) togglePlayerList(false);
}, true);

async function syncTime(samples = 4) {
  if (!client || (import.meta.env.DEV && (window as any).__holdTime)) return;
  let best = Infinity;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const s = await client.mutation(api.time.now, {});
    const t1 = Date.now();
    if (t1 - t0 < best) {
      best = t1 - t0;
      timeOffset = s + best / 2 - t1;
    }
  }
}

/** Keep-alive while not moving. Others drop us after 20 s without one (and convex/players.ts join). */
const HEARTBEAT_MS = 5000;
/** Walking: others smooth toward each update, so 150 ms looks the same as faster. */
const WALK_SEND_MS = 150;
/** Driven rides (bumper cars): collisions between players need fresher positions. */
const DRIVE_SEND_MS = 110;
let lastSent = { x: 0, y: 0, z: 0, ry: 0, anim: "", t: 0 };
let inflight = false;
const sendPos = new THREE.Vector3();
/**
 * Streams our position (players.update, the hottest Convex call: every write re-runs players.list
 * for everyone). Standing still, or seated on a clock-driven ride (`clockDriven`: everyone places
 * us from `ride` + the shared clock), only sends a keep-alive heartbeat.
 */
function netTick(pos: THREE.Vector3, ry: number, anim: string, clockDriven = false, every = WALK_SEND_MS) {
  if (!client || !myPos || inflight) return;
  const t = performance.now();
  if (t - lastSent.t < every) return;
  const moved =
    anim !== lastSent.anim ||
    (!clockDriven && (Math.abs(pos.x - lastSent.x) + Math.abs(pos.y - lastSent.y) + Math.abs(pos.z - lastSent.z) > 0.04 || Math.abs(ry - lastSent.ry) > 0.05));
  if (!moved && t - lastSent.t < HEARTBEAT_MS) return;
  lastSent = { x: pos.x, y: pos.y, z: pos.z, ry, anim, t };
  inflight = true;
  client
    .mutation(api.players.update, { pos: myPos, x: pos.x, y: pos.y, z: pos.z, ry, anim })
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
  if (r) {
    myId = r.id;
    myPos = r.pos;
  }
}

// ---------------- chat ----------------
const chatLog = $("chatLog");
const chatForm = $("chatForm") as HTMLFormElement;
const chatInput = $("chatInput") as HTMLInputElement;
const seenMsgs = new Set<string>();
let firstChat = true;
/** A chat line fades after CHAT_FADE_MS (still shown while the chat box is open) and is gone after CHAT_KEEP_MS. */
const CHAT_FADE_MS = 12000;
const CHAT_KEEP_MS = 3 * 60_000;
/** `age`: how old the message already is (history loaded on join). */
function addChatLine(name: string | null, color: string, text: string, rich = false, age = 0) {
  const d = document.createElement("div");
  d.className = "msg" + (name ? "" : " sys");
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
  setTimeout(() => d.classList.add("old"), Math.max(4000, CHAT_FADE_MS - age));
  setTimeout(() => d.remove(), CHAT_KEEP_MS - age);
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
// background music: on by default, the choice is remembered
const MUSIC_KEY = "cvgt-music";
function applyMusicBtn() {
  setRich($("musicBtn"), sfx.musicOn ? "{music}" : "{nomusic}");
  $("musicBtn").title = sfx.musicOn ? "Tắt nhạc nền (M)" : "Bật nhạc nền (M)";
}
function toggleMusic() {
  sfx.init();
  sfx.setMusicOn(!sfx.musicOn);
  localStorage.setItem(MUSIC_KEY, sfx.musicOn ? "1" : "0");
  applyMusicBtn();
  toast(sfx.musicOn ? "{music} Đã bật nhạc nền" : "{nomusic} Đã tắt nhạc nền", 1200);
}
sfx.setMusicOn(localStorage.getItem(MUSIC_KEY) !== "0");
applyMusicBtn();
$("musicBtn").addEventListener("click", toggleMusic);
$("jumpBtn").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  input.jumpQueued = true;
});
$("exitBtn").addEventListener("click", () => leaveActivity());
$("prompt").addEventListener("click", () => interact());
$("useBtn").addEventListener("click", () => useHeld());
$("waveBtn").addEventListener("click", () => wave());
$("shopClose").addEventListener("click", () => closeShop());
const EXIT_LABEL = isTouch ? "{back} Rời trò chơi" : "{back} Rời trò chơi (Q)";
const EXIT_LABEL_RIDE = isTouch ? "{back} Xuống" : "{back} Xuống (Q)";
setRich($("exitBtn"), EXIT_LABEL);
/** On a ride: hide everything that isn't needed while seated (minimap, location, jump, etc). */
function setRidingUI(on: boolean, exitLabel?: string) {
  document.body.classList.toggle("riding", on);
  // Seated: stack the exit button in the top-left column (players, ride status, exit) so nothing overlaps.
  (on ? $("topLeft") : $("ui")).appendChild($("exitBtn"));
  setRich($("exitBtn"), !on ? EXIT_LABEL : exitLabel ? exitLabel + (isTouch ? "" : " (Q)") : EXIT_LABEL_RIDE);
}

input.onKey = (code) => {
  if (!joined) return;
  if (editing) {
    if (code === "Escape") closeEditor();
    return;
  }
  if (playerListOpen && code === "Escape") return togglePlayerList(false);
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
  else if (code === "KeyG") wave();
  else if (code === "KeyM") toggleMusic();
  else if (code === "KeyR") toggleReactBar();
  else if (/^(Digit|Numpad)[1-9]$/.test(code)) react(+code.slice(-1) - 1);
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
  return rideOf(ride.kind)?.seatPose(ride, now, pos, quat) ?? { ok: false, done: true };
}
function placeOnSeat(a: Avatar, pos: THREE.Vector3, quat: THREE.Quaternion) {
  a.group.quaternion.copy(quat);
  a.group.position.copy(pos).sub(new THREE.Vector3(0, HIP_HEIGHT, 0).applyQuaternion(quat));
}
function ridePoseName(kind: string, speed = 0): Pose {
  return rideOf(kind)?.pose(speed) ?? "sit";
}

async function doBoard(kind: string, key: string, maxSeats: number, start: number, preferSeat?: number) {
  if (!client || !myId || boardingPending) return;
  boardingPending = true;
  try {
    const r = await client.mutation(api.players.board, { id: myId, kind, key, maxSeats, start, preferSeat });
    if (!r) {
      toast("Hết chỗ rồi, thử lại sau nhé!");
      return;
    }
    myRide = r;
    mode = "ride";
    const def = rideOf(r.kind);
    const pitch = def?.camera.pitch ?? [-0.05, -0.42];
    rideLookYaw = 0;
    rideLookPitch = camMode === "fp" ? pitch[0] : pitch[1];
    input.resetStick();
    boardedAt = performance.now();
    sfx.chime();
    setRidingUI(true, def?.exitLabel);
    def?.onBoard?.(r);
    show("exitBtn", true);
    show("prompt", false);
    show("board", false);
  } catch {
    toast("Lỗi kết nối, thử lại nhé");
  } finally {
    boardingPending = false;
  }
}

/** E in a ride's zone: board, or (scheduled rides) join / leave the queue. */
function boardRide(def: RideDef) {
  const now = serverNow();
  if (def.schedule) {
    const st = def.schedule.boardable(now);
    if (!st) {
      queued = queued === def.kind ? null : def.kind;
      if (queued) toast(def.queuedToast ?? "{hourglass} Đã xếp hàng!", 1800);
      return;
    }
    queued = null;
    doBoard(def.kind, st.key, st.maxSeats, st.start);
    return;
  }
  const spec = def.pick?.(now);
  if (typeof spec === "string") toast(spec);
  else if (spec) doBoard(def.kind, spec.key, spec.maxSeats, spec.start, spec.seat);
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
  if (z.ride) boardRide(z.ride);
  else if (z.id === "darts") startDarts();
  else if (z.id === "fountain") wish();
}

// ---------------- fountain wishes & waving ----------------
/** Toss a coin into the fountain (convex/fountain.ts): everyone sees it fly, splash and the jet burst. */
async function wish() {
  if (!client || !myId || wishPending || mode !== "walk") return;
  const bal = xu();
  if (bal !== null && bal < WISH_PRICE) {
    toast(`{coin} Hết Xu để ước rồi! Nạp lại sau ${fmtDur(refillLeft())}`, 3200);
    return;
  }
  wishPending = true;
  // face the water and throw
  me.yaw = camMode === "fp" ? me.yaw : Math.atan2(-me.pos.x, -me.pos.z);
  throwUntil = performance.now() + 650;
  sfx.whoosh();
  const hand = new THREE.Vector3(Math.sin(me.yaw) * 0.35, 1.45, Math.cos(me.yaw) * 0.35).add(me.pos);
  const landed = new Promise<void>((res) =>
    fountain.toss(hand, clock.elapsedTime, () => {
      sfx.splash();
      fountain.burst(clock.elapsedTime);
      res();
    }),
  );
  try {
    // make sure the server has us at the water's edge
    if (myPos) await client.mutation(api.players.update, { pos: myPos, x: me.pos.x, y: me.pos.y, z: me.pos.z, ry: me.yaw, anim: me.pose });
    const r = await client.mutation(api.fountain.wish, { id: myId, token: walletToken });
    await landed;
    if (r.ok) {
      wallet = { balance: r.balance, cycleStart: r.cycleStart };
      fountainSeen = Math.max(fountainSeen, r.count);
      fountain.setCoins(fountainSeen);
      $("wallet").classList.remove("bump");
      void $("wallet").offsetWidth;
      $("wallet").classList.add("bump");
      if (r.lucky) {
        sfx.coin();
        myAvatar?.puff(`+${WISH_LUCKY_XU} Xu!`, performance.now(), "#ffd166");
        toast(`{coin} Trúng lớn! Thần đài phun nước lì xì bạn ${WISH_LUCKY_XU} Xu!`, 3800);
      } else {
        sfx.ding();
        toast(`{star} ${WISHES[Math.floor(Math.random() * WISHES.length)]}`, 3600);
      }
    } else if (r.reason === "poor") {
      if (r.balance !== undefined && wallet) wallet.balance = r.balance;
      toast(`{coin} Hết Xu để ước rồi! Nạp lại sau ${fmtDur(refillLeft())}`, 3200);
    } else if (r.reason === "far") toast("Lại gần đài phun nước hơn chút nhé!");
    else if (r.reason === "player") rejoin();
  } catch {
    toast("Lỗi kết nối, thử lại nhé");
  } finally {
    wishPending = false;
  }
}

/** Wave hello (G / hand button). Others see it through the streamed anim ("…+w"). */
function wave() {
  if (!joined || mode === "darts" || shopCart || editing) return;
  const t = performance.now();
  waveUntil = t + 1800;
  myAvatar?.wave(t, 1800);
}
/** Quick reaction (R bar / 1-6 / heart button): floats over our head; others see it via the streamed anim. */
let lastReactAt = 0;
function react(i: number) {
  const r = REACTIONS[i];
  if (!r || !joined || mode === "darts" || shopCart || editing) return;
  const t = performance.now();
  if (t - lastReactAt < REACT_GAP_MS) return;
  lastReactAt = t;
  reactCount = (reactCount + 1) % 10;
  reactToken = `r${i}${reactCount}`;
  reactUntil = t + REACT_STREAM_MS;
  myAvatar?.react(r.sprite, t);
  sfx.plip();
}
const reactBar = $("reactBar");
function toggleReactBar(on = reactBar.classList.contains("hidden")) {
  if (on && (!joined || mode === "darts" || shopCart || editing)) return;
  reactBar.classList.toggle("hidden", !on);
  $("reactBtn").classList.toggle("on", on);
}
REACTIONS.forEach((r, i) => {
  const b = document.createElement("button");
  b.title = r.label;
  b.append(spriteEl(r.sprite));
  if (!isTouch) {
    const k = document.createElement("kbd");
    k.textContent = String(i + 1);
    b.append(k);
  }
  b.addEventListener("click", () => {
    react(i);
    if (isTouch) toggleReactBar(false);
  });
  reactBar.append(b);
});
$("reactBtn").addEventListener("click", () => toggleReactBar());
/** What we stream as `anim`: the pose, flagged while waving (`+w`) and with a fresh reaction (`+r..`). */
function withFlags(anim: string) {
  const t = performance.now();
  if (t < waveUntil) anim += "+w";
  if (t < reactUntil) anim += "+" + reactToken;
  return anim;
}

/** Fountain row (count = coins in the basin, last = latest wish). -1 until the first update. */
let fountainSeen = -1;
let showWasOn = false;

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
  toggleReactBar(false);
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
    if (myPos) await client.mutation(api.players.update, { pos: myPos, x: me.pos.x, y: me.pos.y, z: me.pos.z, ry: me.yaw, anim: me.pose });
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
  const def = rideOf(myRide.kind);
  if (def) me.pos.copy(def.exit(myRide, serverNow()));
  if (def?.standOnMove) {
    // stand up looking where we looked while seated
    me.yaw = seatYaw;
    camYaw = seatYaw + rideLookYaw + (def.camera.lookBack && camMode === "tp" ? Math.PI : 0);
    camPitch = Math.max(-0.6, Math.min(0.3, rideLookPitch));
  }
  def?.onLeave?.(myRide);
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
  toggleReactBar(false);
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
  else queued = null;
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
  toggleReactBar(false);
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
  // who (re-runs on join / board / buy...) and where (re-runs on every position update), kept
  // apart so the hot query reads only small rows
  c.onUpdate(api.players.list, {}, (list) => {
    roster = list as RosterDoc[];
    syncRemotes(mergedPlayers());
  });
  c.onUpdate(api.players.positions, {}, (list) => {
    posByPlayer = new Map(list.map((q) => [q.p, q]));
    syncRemotes(mergedPlayers());
  });
  c.onUpdate(api.chat.recent, {}, (msgs) => {
    const now = serverNow();
    for (const m of msgs) {
      if (seenMsgs.has(m._id)) continue;
      seenMsgs.add(m._id);
      // joining: skip what was said a while ago
      const age = Math.max(0, now - m._creationTime);
      if (age > CHAT_KEEP_MS - 5000) continue;
      addChatLine(m.name, m.color, m.text, false, age);
      if (!firstChat && now - m._creationTime < 20000) {
        if (m.playerId === myId) myAvatar?.say(m.text, performance.now());
        else remotes.get(m.playerId)?.avatar.say(m.text, performance.now());
        if (m.playerId !== myId) sfx.chime();
      }
    }
    firstChat = false;
  });
  c.onUpdate(api.fountain.state, {}, (f) => {
    const first = fountainSeen < 0;
    if (f.count <= fountainSeen) return;
    fountainSeen = f.count;
    const w = f.last;
    // someone else's wish: play their coin toss (ours plays from wish())
    if (!first && w && w.player !== myId && serverNow() - w.at < 15000) {
      const r = remotes.get(w.player);
      const from = r ? r.avatar.group.position.clone().setY(1.45) : new THREE.Vector3(w.x, 1.45, w.z);
      r?.avatar.puff("ước nè!", performance.now());
      fountain.toss(from, clock.elapsedTime, () => {
        fountain.setCoins(fountainSeen);
        fountain.burst(clock.elapsedTime);
        if (me.pos.lengthSq() < 30 * 30) sfx.splash();
      });
      if (w.lucky) addChatLine(null, "", `{coin} ${w.name.replace(/[{}]/g, "")} vừa được thần đài phun nước lì xì ${WISH_LUCKY_XU} Xu!`, true);
    } else if (first || w?.player !== myId) fountain.setCoins(f.count);
  });
  c.onUpdate(api.scores.top, { game: "darts" }, (s) => {
    topScores = s;
    renderBoard();
  });
  // clocks drift by milliseconds per hour; re-sync rarely (each sample is a Convex call)
  setInterval(() => syncTime(2).catch(() => {}), 5 * 60_000);
}

/** Joins as the saved profile. Returns false if this device has none yet. */
async function enter() {
  const c = await connect();
  const r = await c.mutation(api.players.join, { token: walletToken, fallback: spawnPoint() });
  if (!r) return false;
  wallet = await c.mutation(api.shop.open, { token: walletToken });
  myId = r.id;
  myPos = r.pos;
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
  addChatLine(null, "", isTouch ? "{heart} Bấm nút trái tim để thả cảm xúc cho mọi người cùng thấy." : "{heart} Bấm R hoặc phím 1–6 để thả cảm xúc, G để vẫy tay.", true);
  toast(isTouch ? "Kéo bên trái để đi, bên phải để nhìn" : "WASD để đi · kéo chuột để nhìn · V đổi góc nhìn · G vẫy tay", 4000);
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
  for (const r of rides.list) r.drawMap?.(g, toMap, mm.width / MM.size);
  g.strokeStyle = "rgba(255,255,255,.8)";
  g.lineWidth = 1;
  const [bx0, bz0] = toMap(BOUNDS.minX, BOUNDS.minZ);
  const [bx1, bz1] = toMap(BOUNDS.maxX, BOUNDS.maxZ);
  g.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
  for (const c of CARTS) if (isSprite(c.sprite)) drawSprite(g, c.sprite, ...toMap(c.x, c.z), 10);
  for (const r of rides.list) if (r.place) drawSprite(g, r.place.icon, ...toMap(r.place.x, r.place.z), 16);
  for (const [e, x, z] of [["target", -52, 16], ["fountain", 0, 0], ["gate", 0, 96]] as const) drawSprite(g, e, ...toMap(x, z), 16);
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
/** DEV only (__game.cine): takes over the camera after the game has placed it (promo/trailer capture). */
let cine: ((cam: THREE.PerspectiveCamera, now: number, t: number) => THREE.Vector3 | void) | null = null;
const lookDir = new THREE.Vector3();
const eye = new THREE.Vector3();
const focus = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = serverNow();
  frameNo++;

  for (const r of rides.list) r.update?.(now, t);
  park.update(t);
  fountain.update(now, t);
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
    if (me.onGround && performance.now() < throwUntil) me.pose = "throw";

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
    netTick(me.pos, me.yaw, withFlags(me.pose));

    // zones / prompt
    const z = currentZone();
    if (queued && z?.id !== queued) queued = null;
    if (z) {
      const def = z.ride;
      const isQueued = !!def && queued === def.kind;
      // queued for a scheduled ride: hop on as soon as it's boarding
      if (isQueued && def.schedule?.boardable(now, 3)) boardRide(def);
      const key = isTouch ? "" : " (E)";
      setText("prompt", def ? def.prompt(now, isQueued) : z.id === "fountain" ? `{coin} Ném xu ước nguyện · ${WISH_PRICE} Xu${key}` : `{target} Chơi ném phi tiêu${key}`);
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
    const def = rideOf(myRide.kind);
    let res: RideResult;
    let jumped = false;
    if (!def) res = { ok: false, done: true };
    else if (def.drive) res = def.drive(dt, tmpPos, tmpQuat);
    else {
      jumped = input.consumeJump();
      res = def.seatPose(myRide, now, tmpPos, tmpQuat);
    }
    if (def?.standOnMove && res.ok) seatYaw = new THREE.Euler().setFromQuaternion(tmpQuat, "YXZ").y;
    if (def?.standOnMove && performance.now() - boardedAt > 500 && (jumped || input.move().mag > 0.25)) {
      leaveRide();
    } else if (!def || !res.ok || res.done) {
      leaveRide();
      if (def?.doneToast) toast(def.doneToast, 3500);
      sfx.ding();
    } else {
      const cam = def.camera;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(tmpQuat);
      eye.set(0, EYE_OFFSET, 0.06).applyQuaternion(tmpQuat).add(tmpPos);
      const ly = rideLookYaw + (cam.lookBack && camMode === "tp" ? Math.PI : 0);
      lookDir.set(Math.sin(ly) * Math.cos(rideLookPitch), Math.sin(rideLookPitch), Math.cos(ly) * Math.cos(rideLookPitch)).applyQuaternion(tmpQuat);
      const speed = res.speed ?? 0;
      if (camMode === "fp") {
        camera.position.copy(eye);
        if (cam.shakeAbove !== undefined && speed > cam.shakeAbove) {
          const sh = (speed - cam.shakeAbove) * 0.0012;
          camera.position.x += (Math.random() - 0.5) * sh;
          camera.position.y += (Math.random() - 0.5) * sh;
        }
        camera.up.copy(up);
        camera.lookAt(eye.clone().add(lookDir));
      } else {
        camera.position.copy(eye).addScaledVector(lookDir, -Math.max(camDist, cam.tpMin ?? 0));
        if (cam.floor !== undefined && camera.position.y < cam.floor) camera.position.y = cam.floor;
        camera.up.copy(cam.tilt ? up : UP);
        camera.lookAt(eye);
      }
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake = Math.max(0, shake - dt * 0.8);
      }
      fov = damp(fov, cam.fov ? cam.fov(speed) : 70, 3, dt);
      focus.copy(tmpPos);
      if (myAvatar) {
        placeOnSeat(myAvatar, tmpPos, tmpQuat);
        myAvatar.animate(def.pose(speed), 1, dt, performance.now());
        myAvatar.setFirstPerson(camMode === "fp");
      }
      const ns = def.netState?.();
      if (ns) netTick(ns.pos, ns.ry, withFlags(ns.anim), false, DRIVE_SEND_MS);
      else netTick(sendPos.copy(tmpPos), me.yaw, withFlags(def.pose(0)), true);

      if (def.hud) def.hud(res, dt);
      else {
        show("rideHud", false);
        sfx.setWind(0);
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

  // the fountain's water show is starting: tell whoever is around the plaza
  const showOn = fountain.showPhase(now) >= 0;
  if (showOn && !showWasOn && joined && !shopCart && (mode === "ride" ? tmpPos : me.pos).lengthSq() < 30 * 30) toast("{fountain} Đài phun nước bắt đầu biểu diễn!", 3000);
  showWasOn = showOn;

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
    const { base: anim, waving } = parseAnim(r.anim);
    if (waving) r.avatar.wave(performance.now(), 300);
    let pose: Pose = (["idle", "walk", "run", "jump", "throw"].includes(anim) ? anim : "idle") as Pose;
    let seated = false;
    const def = rideOf(r.ride?.kind);
    if (r.ride && def?.follow) {
      // a ride its owner steers: follow their streamed state
      def.follow(r, dt, tmpPos, tmpQuat);
      placeOnSeat(r.avatar, tmpPos, tmpQuat);
      pose = def.pose(0);
      seated = true;
    } else if (r.ride && def) {
      const res = def.seatPose(r.ride, now, tmpPos, tmpQuat);
      if (res.ok && !res.done) {
        placeOnSeat(r.avatar, tmpPos, tmpQuat);
        pose = def.pose(res.speed ?? 0);
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
      if (pose === "sit" || pose === "bench" || pose === "horse" || pose === "cheer") pose = "idle";
    }
    showHeld(r.avatar, r.held);
    r.avatar.animate(pose, 1, dt, performance.now());
  }
  if (frameNo % 120 === 0 && latestPlayers.length) syncRemotes(latestPlayers);
  for (const r of rides.list) r.afterRemotes?.(t);

  // ride music by proximity
  const lp = mode === "ride" ? tmpPos : me.pos;
  const dMusic = music ? Math.hypot(lp.x - music.x, lp.z - music.z) : Infinity;
  sfx.setMusic(joined ? Math.max(0, Math.min(1, 1 - (dMusic - 6) / 35)) : 0);
  // park tune: quieter on the join screen and while riding (wind and screams take over)
  sfx.setBgm(!joined ? 0.6 : mode === "ride" ? 0.55 : 1);

  // where am I
  if (joined && frameNo % 15 === 0) {
    const pl = places.find((p) => Math.hypot(lp.x - p.x, lp.z - p.z) < p.r);
    setText("where", pl ? pl.n : "{tree} Công viên");
    if (frameNo % 30 === 0) drawMinimap();
  }

  if (import.meta.env.DEV && cine) {
    const f = cine(camera, now, t);
    if (f) focus.copy(f);
    camera.updateProjectionMatrix();
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
    me, ...rides.world, rides: rides.byKind, darts, serverNow, interact, toggleCam,
    get mode() { return mode; },
    get ride() { return myRide; },
    get held() { return myHeld; },
    get wallet() { return wallet; },
    vendors, openShop: (i: number) => openShop(CARTS[i]), buy, useHeld, fountain, wish, wave, react, sfx, toggleMusic,
    get wishing() { return wishPending; },
    cartFront: (i: number) => cartFront(CARTS[i]),
    tp(x: number, z: number) { me.pos.set(x, 0, z); },
    /** Jump the shared clock forward (seconds). Local only: the server and other players don't see it. */
    warp(sec: number) { warpMs += sec * 1000; },
    /** Seconds until a scheduled ride (coaster, drop) next starts boarding. */
    nextBoarding(kind: string) { return rideOf(kind)?.schedule?.nextBoarding(serverNow()) ?? null; },
    camera, scene, renderer, remotes,
    set cine(f: typeof cine) { cine = f; },
    setCam(m: "fp" | "tp", yaw?: number, pitch?: number) { camMode = m; if (yaw !== undefined) { camYaw = yaw; rideLookYaw = 0; } if (pitch !== undefined) { camPitch = pitch; rideLookPitch = pitch; } },
  };
}
