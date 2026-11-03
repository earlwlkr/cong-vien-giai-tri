import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const rideValidator = v.object({
  kind: v.string(), // "coaster" | "wheel" | "carousel" | "darts"
  key: v.string(),
  seat: v.number(),
  start: v.number(),
});

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
    lastSeen: v.number(),
  })
    .index("by_lastSeen", ["lastSeen"])
    .index("by_ride_key", ["ride.key"]),
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
