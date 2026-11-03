import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const STALE_MS = 20_000;

function cleanName(name: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 18);
  return n.length ? n : "Khách";
}
function cleanColor(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ff6b6b";
}

export const join = mutation({
  args: { name: v.string(), color: v.string(), x: v.number(), z: v.number() },
  handler: async (ctx, a) => {
    return await ctx.db.insert("players", {
      name: cleanName(a.name),
      color: cleanColor(a.color),
      x: a.x,
      y: 0,
      z: a.z,
      ry: 0,
      anim: "idle",
      ride: null,
      held: null,
      lastSeen: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("players"),
    x: v.number(),
    y: v.number(),
    z: v.number(),
    ry: v.number(),
    anim: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p) return false;
    const clamp = (n: number, m: number) => (Number.isFinite(n) ? Math.max(-m, Math.min(m, n)) : 0);
    await ctx.db.patch(a.id, {
      x: clamp(a.x, 400),
      y: clamp(a.y, 200),
      z: clamp(a.z, 400),
      ry: clamp(a.ry, 1000),
      anim: a.anim.slice(0, 12),
      lastSeen: Date.now(),
    });
    return true;
  },
});

export const leave = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (p) await ctx.db.delete(id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    // lastSeen is filtered client-side against synced time; cron removes stale rows.
    const players = await ctx.db.query("players").take(200);
    return players.map((p) => ({
      _id: p._id,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      z: p.z,
      ry: p.ry,
      anim: p.anim,
      ride: p.ride ?? null,
      held: p.held ?? null,
      lastSeen: p.lastSeen,
    }));
  },
});

/** Claim a seat on a ride. Seats are unique per ride key (a train departure, a gondola, a horse...). */
export const board = mutation({
  args: {
    id: v.id("players"),
    kind: v.string(),
    key: v.string(),
    maxSeats: v.number(),
    start: v.number(),
    preferSeat: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p) return null;
    const now = Date.now();
    const others = await ctx.db
      .query("players")
      .withIndex("by_ride_key", (q) => q.eq("ride.key", a.key))
      .collect();
    const taken = new Set(
      others.filter((o) => o._id !== a.id && now - o.lastSeen < STALE_MS).map((o) => o.ride!.seat),
    );
    const max = Math.max(1, Math.min(16, Math.floor(a.maxSeats)));
    let seat = -1;
    if (a.preferSeat !== undefined && a.preferSeat >= 0 && a.preferSeat < max && !taken.has(a.preferSeat)) {
      seat = a.preferSeat;
    } else {
      for (let i = 0; i < max; i++) if (!taken.has(i)) { seat = i; break; }
    }
    if (seat < 0) return null;
    const ride = { kind: a.kind.slice(0, 16), key: a.key.slice(0, 64), seat, start: a.start };
    await ctx.db.patch(a.id, { ride, lastSeen: now });
    return ride;
  },
});

export const unboard = mutation({
  args: { id: v.id("players"), x: v.number(), y: v.number(), z: v.number() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p) return;
    await ctx.db.patch(a.id, { ride: null, x: a.x, y: a.y, z: a.z, anim: "idle", lastSeen: Date.now() });
  },
});

export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60_000;
    const stale = await ctx.db
      .query("players")
      .withIndex("by_lastSeen", (q) => q.lt("lastSeen", cutoff))
      .take(200);
    for (const p of stale) await ctx.db.delete(p._id);
    // keep chat history bounded
    const msgs = await ctx.db.query("messages").order("desc").collect();
    for (const m of msgs.slice(300)) await ctx.db.delete(m._id);
  },
});
