import { mutation, query, internalMutation, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { lookValidator, spotValidator } from "./schema";
import { cleanLook } from "./looks";
import { dayOf, logEvent } from "./stats";

/** A seat claim / online count ignores players silent this long. */
const STALE_MS = 20_000;
/** A row seen this recently belongs to a tab that's still open (> the client's 5 s heartbeat). */
const LIVE_MS = 8_000;
const validToken = (t: string) => /^[A-Za-z0-9-]{16,64}$/.test(t);

function cleanName(name: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 18);
  return n.length ? n : "Khách";
}
function cleanColor(c: string) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ff6b6b";
}

const clamp = (n: number, m: number) => (Number.isFinite(n) ? Math.max(-m, Math.min(m, n)) : 0);

export const posOf = (ctx: QueryCtx, id: Id<"players">) =>
  ctx.db.query("positions").withIndex("by_player", (q) => q.eq("player", id)).unique();

/** Where a player last stood on foot: their position, unless they're on a ride. */
function spotOf(p: Doc<"players">, pos: Doc<"positions"> | null) {
  return pos && !pos.riding ? { x: pos.x, z: pos.z, ry: pos.ry } : (p.spot ?? null);
}

/** Remembers where a player row was last on foot in its profile (newest row wins). */
async function persist(ctx: MutationCtx, p: Doc<"players">, pos: Doc<"positions"> | null) {
  if (!p.profile) return;
  const s = spotOf(p, pos);
  const seen = pos?.lastSeen ?? p._creationTime;
  const prof = await ctx.db.get(p.profile);
  if (!s || !prof || (prof.savedAt ?? 0) > seen) return;
  await ctx.db.patch(prof._id, { x: s.x, z: s.z, ry: s.ry, savedAt: seen });
}

/** Saves the spot into the profile and deletes the player and its position. */
async function remove(ctx: MutationCtx, p: Doc<"players">, pos: Doc<"positions"> | null) {
  await persist(ctx, p, pos);
  if (pos) await ctx.db.delete(pos._id);
  await ctx.db.delete(p._id);
}

/**
 * Enters the park as the device's saved profile. Returns null when the device has no profile yet
 * (the client then shows the character picker). Spawns where the player last left the park unless
 * `at` is given (reconnecting mid-session keeps the current spot); `fallback` is for first visits.
 * Returns the player id plus `pos`, the positions row players.update writes to.
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
      const pos = await posOf(ctx, p._id);
      const seen = pos?.lastSeen ?? 0;
      if (now - seen < LIVE_MS) continue;
      const s = spotOf(p, pos);
      if (s && seen >= savedAt) { spot = s; savedAt = seen; }
      await remove(ctx, p, pos);
    }
    const at = a.at ?? spot ?? { x: a.fallback.x, z: a.fallback.z, ry: Math.PI };
    const here = { x: clamp(at.x, 400), z: clamp(at.z, 400), ry: clamp(at.ry, 1000) };
    const look = cleanLook(prof.look);
    const id = await ctx.db.insert("players", {
      name: prof.name,
      color: prof.color,
      look,
      profile: prof._id,
      spot: here,
      ride: null,
      held: null,
    });
    const pos = await ctx.db.insert("positions", { player: id, ...here, y: 0, anim: "idle", lastSeen: now, riding: false });
    // Stats: a visit is a join that isn't a reconnect (`at`); the day's first one counts the player.
    const first = prof.lastDay !== dayOf(now);
    if (first) await ctx.db.patch(prof._id, { lastDay: dayOf(now) });
    if (!a.at || first) await logEvent(ctx, { type: "join", profile: prof._id, first });
    return { id, pos, name: prof.name, color: prof.color, look, ...here, resumed: !a.at && !!spot };
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

/** The hot path (every ~110 ms per moving player): touches only the small positions row. */
export const update = mutation({
  args: {
    pos: v.id("positions"),
    x: v.number(),
    y: v.number(),
    z: v.number(),
    ry: v.number(),
    anim: v.string(),
  },
  handler: async (ctx, a) => {
    if (!(await ctx.db.get(a.pos))) return false;
    await ctx.db.patch(a.pos, {
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
    if (p) await remove(ctx, p, await posOf(ctx, id));
  },
});

/** Who's in the park and what they're doing (re-runs only when that changes). Stale rows included: clients filter by positions' lastSeen. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").take(200);
    return players.map((p) => ({
      _id: p._id,
      name: p.name,
      color: p.color,
      ride: p.ride ?? null,
      held: p.held ?? null,
      look: p.look ?? null,
    }));
  },
});

/** Where everyone is (re-runs after every players.update, so it reads only the small rows). */
export const positions = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("positions").take(200);
    return rows.map((q) => ({ p: q.player, x: q.x, y: q.y, z: q.z, ry: q.ry, anim: q.anim, t: q.lastSeen }));
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
    const taken = new Set<number>();
    for (const o of others) {
      if (o._id === a.id) continue;
      const op = await posOf(ctx, o._id);
      if (op && now - op.lastSeen < STALE_MS) taken.add(o.ride!.seat);
    }
    const max = Math.max(1, Math.min(16, Math.floor(a.maxSeats)));
    let seat = -1;
    if (a.preferSeat !== undefined && a.preferSeat >= 0 && a.preferSeat < max && !taken.has(a.preferSeat)) {
      seat = a.preferSeat;
    } else {
      for (let i = 0; i < max; i++) if (!taken.has(i)) { seat = i; break; }
    }
    if (seat < 0) return null;
    const ride = { kind: a.kind.slice(0, 16), key: a.key.slice(0, 64), seat, start: a.start };
    const pos = await posOf(ctx, a.id);
    // remember where they got on: from here on their position follows the seat
    await ctx.db.patch(a.id, { ride, ...(pos && !pos.riding ? { spot: { x: pos.x, z: pos.z, ry: pos.ry } } : {}) });
    if (pos) await ctx.db.patch(pos._id, { riding: true, lastSeen: now });
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
    const pos = await posOf(ctx, a.id);
    const ry = pos?.ry ?? p.spot?.ry ?? 0;
    await ctx.db.patch(a.id, { ride: null, spot: { x, z, ry } });
    if (pos) await ctx.db.patch(pos._id, { x, y: clamp(a.y, 200), z, anim: "idle", riding: false, lastSeen: Date.now() });
  },
});

/** Every 2 min: players gone for a minute (closed tab without `leave`). Scans the small rows. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60_000;
    const rows = await ctx.db.query("positions").take(1000);
    for (const pos of rows) {
      if (pos.lastSeen >= cutoff) continue;
      const p = await ctx.db.get(pos.player);
      if (p) await remove(ctx, p, pos);
      else await ctx.db.delete(pos._id);
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
