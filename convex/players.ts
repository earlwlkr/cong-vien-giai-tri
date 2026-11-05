import { mutation, query, internalMutation, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { lookValidator, spotValidator } from "./schema";
import { cleanLook } from "./looks";
import { dayOf, logEvent } from "./stats";

const STALE_MS = 20_000;
const validToken = (t: string) => /^[A-Za-z0-9-]{16,64}$/.test(t);

function cleanName(name: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 18);
  return n.length ? n : "Khách";
}
function cleanColor(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ff6b6b";
}

const clamp = (n: number, m: number) => (Number.isFinite(n) ? Math.max(-m, Math.min(m, n)) : 0);
const spotOf = (p: Doc<"players">) => p.spot ?? (p.ride ? null : { x: p.x, z: p.z, ry: p.ry });

/** Remembers where a player row was last on foot in its profile (newest row wins). */
async function persist(ctx: MutationCtx, p: Doc<"players">) {
  if (!p.profile) return;
  const s = spotOf(p);
  const prof = await ctx.db.get(p.profile);
  if (!s || !prof || (prof.savedAt ?? 0) > p.lastSeen) return;
  await ctx.db.patch(prof._id, { x: s.x, z: s.z, ry: s.ry, savedAt: p.lastSeen });
}

/**
 * Enters the park as the device's saved profile. Returns null when the device has no profile yet
 * (the client then shows the character picker). Spawns where the player last left the park unless
 * `at` is given (reconnecting mid-session keeps the current spot); `fallback` is for first visits.
 */
export const join = mutation({
  args: {
    token: v.string(),
    fallback: v.object({ x: v.number(), z: v.number() }),
    at: v.optional(spotValidator),
  },
  handler: async (ctx, a) => {
    if (!validToken(a.token)) throw new Error("bad token");
    const prof = await ctx.db.query("profiles").withIndex("by_token", (q) => q.eq("token", a.token)).unique();
    if (!prof) return null;
    const now = Date.now();
    let spot = prof.x !== undefined && prof.z !== undefined ? { x: prof.x, z: prof.z, ry: prof.ry ?? 0 } : null;
    let savedAt = prof.savedAt ?? 0;
    // A reload leaves the old row behind for a few seconds: start from it and clear it away.
    // Rows that are still live belong to another open tab and are left alone.
    const rows = await ctx.db.query("players").withIndex("by_profile", (q) => q.eq("profile", prof._id)).collect();
    for (const p of rows) {
      if (now - p.lastSeen < 8000) continue; // > the client's 5 s heartbeat
      await persist(ctx, p);
      const s = spotOf(p);
      if (s && p.lastSeen >= savedAt) { spot = s; savedAt = p.lastSeen; }
      await ctx.db.delete(p._id);
    }
    const at = a.at ?? spot ?? { x: a.fallback.x, z: a.fallback.z, ry: Math.PI };
    const pos = { x: clamp(at.x, 400), z: clamp(at.z, 400), ry: clamp(at.ry, 1000) };
    const look = cleanLook(prof.look);
    const id = await ctx.db.insert("players", {
      name: prof.name,
      color: prof.color,
      look,
      profile: prof._id,
      spot: pos,
      x: pos.x,
      y: 0,
      z: pos.z,
      ry: pos.ry,
      anim: "idle",
      ride: null,
      held: null,
      lastSeen: now,
    });
    // Stats: a visit is a join that isn't a reconnect (`at`); the day's first one counts the player.
    const first = prof.lastDay !== dayOf(now);
    if (first) await ctx.db.patch(prof._id, { lastDay: dayOf(now) });
    if (!a.at || first) await logEvent(ctx, { type: "join", profile: prof._id, first });
    return { id, name: prof.name, color: prof.color, look, ...pos, resumed: !a.at && !!spot };
  },
});

/** Creates or edits the device's profile; also restyles the live player row if one is given. */
export const saveProfile = mutation({
  args: { token: v.string(), name: v.string(), color: v.string(), look: lookValidator, id: v.optional(v.id("players")) },
  handler: async (ctx, a) => {
    if (!validToken(a.token)) throw new Error("bad token");
    const fields = { name: cleanName(a.name), color: cleanColor(a.color), look: cleanLook(a.look) };
    const prof = await ctx.db.query("profiles").withIndex("by_token", (q) => q.eq("token", a.token)).unique();
    const profId = prof ? (await ctx.db.patch(prof._id, fields), prof._id) : await ctx.db.insert("profiles", { token: a.token, ...fields });
    if (!prof) await logEvent(ctx, { type: "new", profile: profId });
    if (a.id) {
      const p = await ctx.db.get(a.id);
      if (p && p.profile === profId) await ctx.db.patch(a.id, fields);
    }
    return fields;
  },
});

/** Saved name and look for the device, or null on a first visit. */
export const profile = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!validToken(token)) return null;
    const p = await ctx.db.query("profiles").withIndex("by_token", (q) => q.eq("token", token)).unique();
    return p ? { name: p.name, color: p.color, look: cleanLook(p.look) } : null;
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
    const x = clamp(a.x, 400), z = clamp(a.z, 400), ry = clamp(a.ry, 1000);
    await ctx.db.patch(a.id, {
      x,
      y: clamp(a.y, 200),
      z,
      ry,
      anim: a.anim.slice(0, 12),
      ...(p.ride ? {} : { spot: { x, z, ry } }),
      lastSeen: Date.now(),
    });
    return true;
  },
});

export const leave = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p) return;
    await persist(ctx, p);
    await ctx.db.delete(id);
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
      look: p.look ?? null,
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
    if (p.ride?.key !== ride.key) await logEvent(ctx, { type: "board", kind: ride.kind, profile: p.profile });
    return ride;
  },
});

export const unboard = mutation({
  args: { id: v.id("players"), x: v.number(), y: v.number(), z: v.number() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p) return;
    const x = clamp(a.x, 400), z = clamp(a.z, 400);
    await ctx.db.patch(a.id, { ride: null, x, y: clamp(a.y, 200), z, spot: { x, z, ry: p.ry }, anim: "idle", lastSeen: Date.now() });
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
    for (const p of stale) {
      await persist(ctx, p);
      await ctx.db.delete(p._id);
    }
  },
});

/** Hourly: drops chat older than CHAT_DAYS, but never the last CHAT_KEEP lines the client shows. */
const CHAT_DAYS = 3;
const CHAT_KEEP = 40;
export const pruneChat = internalMutation({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query("messages").order("desc").take(CHAT_KEEP);
    if (recent.length < CHAT_KEEP) return;
    const cutoff = Math.min(Date.now() - CHAT_DAYS * 86_400_000, recent[CHAT_KEEP - 1]._creationTime);
    const old = await ctx.db
      .query("messages")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(500);
    for (const m of old) await ctx.db.delete(m._id);
  },
});
