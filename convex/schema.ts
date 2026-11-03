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
  }).index("by_token", ["token"]),
  messages: defineTable({
    playerId: v.id("players"),
    name: v.string(),
    color: v.string(),
    text: v.string(),
  }),
  /** Xu balance per device (random token kept in localStorage); survives player rows. */
  wallets: defineTable({
    token: v.string(),
    balance: v.number(),
    /** When the current spending cycle started; refills XU_REFILL_MS later. */
    cycleStart: v.number(),
    lastBuy: v.number(),
  }).index("by_token", ["token"]),
  scores: defineTable({
    game: v.string(),
    name: v.string(),
    color: v.string(),
    score: v.number(),
  }).index("by_game_score", ["game", "score"]),
});
