import type * as THREE from "three";
import type { Avatar, Pose } from "../avatar";
import type { Sfx } from "../audio";
import type { Input } from "../input";
import type { SpriteName } from "../sprites";
import type { BoxCollider, Collider } from "../util";

/** A seat claim, as stored on the player row (`players.ride`). `key` is unique per seat group, e.g. "coaster:1:4821" or "carousel:7". */
export type Ride = { kind: string; key: string; seat: number; start: number };

export type RideResult = {
  ok: boolean;
  /** The ride is over: the game drops the rider at `exit()`. */
  done: boolean;
  speed?: number;
  g?: number;
  waiting?: number;
  lift?: boolean;
  height?: number;
  left?: number;
  phase?: string;
  /** Swing / lean angle (rad), e.g. the pirate ship's swing. */
  angle?: number;
  /** Spin rate in turns per minute. */
  rpm?: number;
};

/** Another player as this client sees them. */
export interface RemoteView {
  avatar: Avatar;
  /** Smoothed position; `target` is the latest streamed one. */
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  anim: string;
  ride: Ride | null;
}

/** What the game hands every ride: HUD, sound, input and who else is around. */
export interface RideEnv {
  sfx: Sfx;
  input: Input;
  isTouch: boolean;
  me: { pos: THREE.Vector3 };
  serverNow(): number;
  toast(text: string, ms?: number): void;
  /** Sets a HUD element's text ({sprite} tokens allowed); cached, so calling it every frame is cheap. */
  setText(id: string, text: string): void;
  show(id: string, on: boolean): void;
  /** Kicks the camera (decays on its own). */
  shake(amount: number): void;
  myAvatar(): Avatar | null;
  /** Remote players currently in the park, by player id. */
  remotes(): Iterable<[string, RemoteView]>;
  /** Seat-group indices ("kind:i" keys) other live players hold on this ride. */
  takenSeats(kind: string): Set<number>;
}

export interface BoardSpec {
  key: string;
  maxSeats: number;
  /** Stored as `ride.start` (e.g. the departure the seat belongs to). */
  start: number;
  /** Seat to take if it's free (e.g. the end of the bench you're standing at). */
  seat?: number;
}

/**
 * Everything the game needs to know about one ride. Adding a ride = a world class in src/world/,
 * a def in src/rides/, and one line in src/rides/index.ts. Nothing in main.ts.
 */
export interface RideDef {
  kind: string;
  /** Note in the online-player list, e.g. "tàu lượn". */
  label: string;
  /** "Where am I" pill area and minimap marker (none for things all over the park, like benches). */
  place?: { name: string; icon: SpriteName; x: number; z: number; r: number };
  /** Stand here to get the boarding prompt. */
  zone: { x: number; z: number; r: number };
  /** Several boarding spots (e.g. every bench); replaces `zone` for the prompt when set. */
  zones?: { x: number; z: number; r: number }[];

  // ---- world ----
  object: THREE.Object3D;
  colliders: Collider[];
  boxes?: BoxCollider[];
  /** Keeps trees out of the ride's footprint. */
  blocks(x: number, z: number): boolean;
  /** Extra minimap drawing under the icons (track, floor...). */
  drawMap?(g: CanvasRenderingContext2D, toMap: (x: number, z: number) => readonly [number, number], pxPerM: number): void;
  /** Every frame, before players are placed. */
  update?(now: number, t: number): void;
  /** Background music source; volume follows distance. */
  music?: THREE.Vector3;

  // ---- boarding ----
  /** Rides leaving on a shared timetable. Players can queue (E again cancels) and auto-board. */
  schedule?: {
    boardable(now: number, minLeft?: number): (BoardSpec & { left: number }) | null;
    nextBoarding(now: number): number;
  };
  /** Prompt text in the zone. The game appends the key hint unless `queued`. */
  prompt(now: number, queued: boolean): string;
  /** Unscheduled rides: pick a seat, or return a message to toast (e.g. full). */
  pick?(now: number): BoardSpec | string;
  queuedToast?: string;
  onBoard?(ride: Ride): void;
  onLeave?(ride: Ride): void;

  // ---- riding ----
  /** Hip position + orientation of a seat (forward +Z, up +Y). Used for every rider on clock-driven rides. */
  seatPose(ride: Ride, now: number, pos: THREE.Vector3, quat: THREE.Quaternion): RideResult;
  /** Rides you steer: advances your own seat instead of `seatPose`. */
  drive?(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion): RideResult;
  /** Driven rides: what to stream instead of the seat. */
  netState?(): { pos: THREE.Vector3; ry: number; anim: string } | null;
  /** Driven rides: place a remote rider from their streamed state (seat pose into pos/quat). */
  follow?(r: RemoteView, dt: number, pos: THREE.Vector3, quat: THREE.Quaternion): void;
  /** A remote rider's streamed anim changed (e.g. honked). */
  remoteAnim?(r: RemoteView, anim: string, prev: string): void;
  /** Every frame, after all players are placed. */
  afterRemotes?(t: number): void;
  pose(speed: number): Pose;
  exit(ride: Ride, now: number): THREE.Vector3;
  camera: {
    /** Minimum third-person distance. */
    tpMin?: number;
    /** Third person looks at the rider from the front (seat faces away from open space otherwise). */
    lookBack?: boolean;
    /** Third-person camera rolls with the seat. */
    tilt?: boolean;
    /** First-person shake above this speed (m/s). */
    shakeAbove?: number;
    /** Keep the camera above this height. */
    floor?: number;
    /** Initial look pitch [first person, third person]. */
    pitch?: [number, number];
    fov?(speed: number): number;
  };
  /** Exit button text while seated (default "Xuống"). */
  exitLabel?: string;
  /** Walking or jumping gets you off (benches). */
  standOnMove?: boolean;
  /** Your own ride's HUD and sounds, every frame. Without it the ride HUD is hidden. */
  hud?(res: RideResult, dt: number): void;
  doneToast?: string;
}

export const keyIndex = (key: string) => +(key.split(":")[1] ?? 0);
