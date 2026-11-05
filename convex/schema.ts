import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const rideValidator = v.object({
  kind: v.string(), // "coaster" | "wheel" | "carousel" | "darts"
  key: v.string(),
  seat: v.number(),
  start: v.number(),
});

export const lookValidator = v.object({ style: v.string(), skin: v.number(), hair: v.number(), shoes: v.number() });
export const spotValidator = v.object({ x: v.number(), z: v.number(), ry: v.number() });

export const heldValidator = v.object({ item: v.string(), left: v.number() });

export default defineSchema({
  players: defineTable({
    name: v.string(),
    color: v.string(),
    x: v.number(),
    y: v.number(),
    z: v.number(),
    ry: v.number(),
    anim: v.string(),
    ride: v.optional(v.union(rideValidator, v.null())),
    /** Food/drink/balloon in hand (server-authoritative: set by shop.buy, consumed by shop.use). */
    held: v.optional(v.union(heldValidator, v.null())),
    look: v.optional(lookValidator),
    /** Saved profile this row plays as (rows are temporary, profiles are not). */
    profile: v.optional(v.id("profiles")),
    /** Last spot on foot; x/y/z follow the seat while riding. Copied into the profile on leave. */
    spot: v.optional(spotValidator),
    lastSeen: v.number(),
  })
    .index("by_lastSeen", ["lastSeen"])
    .index("by_profile", ["profile"])
    .index("by_ride_key", ["ride.key"]),
  /** One per device (same random token as the wallet): name, look and where they left the park. */
  profiles: defineTable({
    token: v.string(),
    name: v.string(),
    color: v.string(),
    look: lookValidator,
    x: v.optional(v.number()),
    z: v.optional(v.number()),
    ry: v.optional(v.number()),
    /** lastSeen of the player row the position came from. */
    savedAt: v.optional(v.number()),
    /** Park day (Vietnam time, "YYYY-MM-DD") of the last visit; marks the day's first join for stats. */
    lastDay: v.optional(v.string()),
  }).index("by_token", ["token"]),
  messages: defineTable({
    playerId: v.id("players"),
    name: v.string(),
    color: v.string(),
    text: v.string(),
  }).index("by_player", ["playerId"]),
  /** Xu balance per device (random token kept in localStorage); survives player rows. */
  wallets: defineTable({
    token: v.string(),
    balance: v.number(),
    /** When the current spending cycle started; refills XU_REFILL_MS later. */
    cycleStart: v.number(),
    lastBuy: v.number(),
  }).index("by_token", ["token"]),
  /**
   * Analytics log, one row per action (see stats.ts): "join" (new visit; `first` = first of the
   * day for this profile), "new" (profile created), "board" (kind = ride), "buy" (kind = item),
   * "darts" (finished game). Rolled up into `daily` each night; raw rows kept EVENT_DAYS.
   */
  events: defineTable({
    type: v.string(),
    kind: v.optional(v.string()),
    profile: v.optional(v.id("profiles")),
    first: v.optional(v.boolean()),
    at: v.number(),
  }).index("by_at", ["at"]),
  /** Every 5 minutes: who is in the park and on which ride. */
  snapshots: defineTable({
    at: v.number(),
    online: v.number(),
    riding: v.record(v.string(), v.number()),
  }).index("by_at", ["at"]),
  /** Per-day totals (Vietnam time) built from `events` + `snapshots` by the nightly rollup. */
  daily: defineTable({
    day: v.string(),
    visits: v.number(),
    players: v.number(),
    newPlayers: v.number(),
    boards: v.record(v.string(), v.number()),
    buys: v.record(v.string(), v.number()),
    darts: v.number(),
    peakOnline: v.number(),
    /** Rollup still paging through the day's events. */
    partial: v.optional(v.boolean()),
  }).index("by_day", ["day"]),
  scores: defineTable({
    game: v.string(),
    name: v.string(),
    color: v.string(),
    score: v.number(),
  }).index("by_game_score", ["game", "score"]),
});
