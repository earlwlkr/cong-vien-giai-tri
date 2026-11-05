// Player and ride analytics. Mutations elsewhere call `logEvent`; crons take a snapshot of who is
// online every 5 minutes and roll each finished day up into `daily`. Read it with
//   npm run stats            (prod, last 7 days; scripts/stats.mjs)   npm run stats -- --days 30
//   npm run stats:dev        (dev deployment)                         npm run stats -- --json
// Days are Vietnam time (UTC+7, no DST).
import { internalMutation, internalQuery, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const TZ_MS = 7 * 3600_000;
const DAY_MS = 86_400_000;
/** How long raw events / snapshots are kept after their day has been rolled up. */
const EVENT_DAYS = 30;
const SNAPSHOT_DAYS = 90;
/** Same freshness as the seat check in players.board. */
const ONLINE_MS = 20_000;
/** Rollup page size, and the cap on raw events a live (not yet rolled up) day may read. */
const PAGE = 2000;
const LIVE_CAP = 6000;
/** Bounds the per-day maps against clients sending made-up ride kinds. */
const MAX_KEYS = 40;

export const dayOf = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(day + "T00:00:00Z") - TZ_MS;

type EventType = "join" | "new" | "board" | "buy" | "darts";
export async function logEvent(
  ctx: MutationCtx,
  e: { type: EventType; kind?: string; profile?: Id<"profiles">; first?: boolean },
) {
  await ctx.db.insert("events", { ...e, at: Date.now() });
}

type Totals = Omit<Doc<"daily">, "_id" | "_creationTime" | "day" | "partial">;
const empty = (): Totals => ({ visits: 0, players: 0, newPlayers: 0, boards: {}, buys: {}, darts: 0, peakOnline: 0 });
const copy = (t: Totals): Totals => ({ ...t, boards: { ...t.boards }, buys: { ...t.buys } });

/** Convex record keys: ASCII, not starting with "$" or "_". */
const cleanKey = (k: string) => k.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 24) || "unknown";
function bump(m: Record<string, number>, raw: string | undefined) {
  const k = cleanKey(raw ?? "");
  if (k in m || Object.keys(m).length < MAX_KEYS) m[k] = (m[k] ?? 0) + 1;
}

function add(t: Totals, e: Doc<"events">) {
  switch (e.type) {
    case "join":
      t.visits++;
      if (e.first) t.players++;
      break;
    case "new":
      t.newPlayers++;
      break;
    case "board":
      bump(t.boards, e.kind);
      break;
    case "buy":
      bump(t.buys, e.kind);
      break;
    case "darts":
      t.darts++;
      break;
  }
}

const dayEvents = (ctx: QueryCtx, day: string) => {
  const from = dayStart(day);
  return ctx.db.query("events").withIndex("by_at", (q) => q.gte("at", from).lt("at", from + DAY_MS));
};
async function peakOnline(ctx: QueryCtx, day: string) {
  const from = dayStart(day);
  const snaps = await ctx.db
    .query("snapshots")
    .withIndex("by_at", (q) => q.gte("at", from).lt("at", from + DAY_MS))
    .collect();
  return snaps.reduce((m, s) => Math.max(m, s.online), 0);
}

async function onlineNow(ctx: QueryCtx) {
  const now = Date.now();
  const live = (await ctx.db.query("positions").take(1000)).filter((q) => now - q.lastSeen < ONLINE_MS);
  const riding: Record<string, number> = {};
  for (const q of live) {
    if (!q.riding) continue;
    const p = await ctx.db.get(q.player);
    if (p?.ride) bump(riding, p.ride.kind);
  }
  return { online: live.length, riding };
}

export const snapshot = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.db.insert("snapshots", { at: Date.now(), ...(await onlineNow(ctx)) });
  },
});

/**
 * Builds `daily` for one day (default: yesterday), paging through its events. Safe to re-run:
 * it starts the day over. Backfill by hand: npx convex run stats:rollup '{"day":"2026-11-04"}'
 */
export const rollup = internalMutation({
  args: { day: v.optional(v.string()), cursor: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const day = a.day ?? dayOf(Date.now() - DAY_MS);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
    let row = await ctx.db.query("daily").withIndex("by_day", (q) => q.eq("day", day)).unique();
    if (!a.cursor) {
      const fresh = { day, ...empty(), peakOnline: await peakOnline(ctx, day), partial: true };
      if (row) await ctx.db.replace(row._id, fresh);
      else await ctx.db.insert("daily", fresh);
      row = await ctx.db.query("daily").withIndex("by_day", (q) => q.eq("day", day)).unique();
    }
    if (!row) return;
    const page = await dayEvents(ctx, day).paginate({ cursor: a.cursor ?? null, numItems: PAGE });
    const { _id, _creationTime, day: _d, partial: _p, ...rest } = row;
    const t = copy(rest);
    for (const e of page.page) add(t, e);
    await ctx.db.patch(row._id, { ...t, partial: !page.isDone });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.stats.rollup, { day, cursor: page.continueCursor });
    else await ctx.scheduler.runAfter(0, internal.stats.prune, {});
  },
});

/** Drops raw events and snapshots past their retention (the `daily` rows stay forever). */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const events = await ctx.db
      .query("events")
      .withIndex("by_at", (q) => q.lt("at", now - EVENT_DAYS * DAY_MS))
      .take(PAGE);
    for (const e of events) await ctx.db.delete(e._id);
    const snaps = await ctx.db
      .query("snapshots")
      .withIndex("by_at", (q) => q.lt("at", now - SNAPSHOT_DAYS * DAY_MS))
      .take(PAGE);
    for (const s of snaps) await ctx.db.delete(s._id);
    if (events.length === PAGE || snaps.length === PAGE) await ctx.scheduler.runAfter(0, internal.stats.prune, {});
  },
});

const ranked = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));

/**
 * Who's in the park now, plus per-day totals for the last `days` days (newest first) and ride /
 * item rankings over that range. Today (and any day not rolled up yet) is counted from raw events.
 */
export const summary = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const n = Math.max(1, Math.min(90, Math.floor(a.days ?? 7)));
    const now = Date.now();
    const today = dayOf(now);
    const days = [];
    const sum = empty();
    for (let i = 0; i < n; i++) {
      const day = dayOf(now - i * DAY_MS);
      const saved = day === today ? null : await ctx.db.query("daily").withIndex("by_day", (q) => q.eq("day", day)).unique();
      let t: Totals;
      let note: string | undefined;
      if (saved && !saved.partial) {
        const { _id, _creationTime, day: _d, partial: _p, ...rest } = saved;
        t = rest;
      } else {
        t = empty();
        const events = await dayEvents(ctx, day).take(LIVE_CAP);
        for (const e of events) add(t, e);
        t.peakOnline = await peakOnline(ctx, day);
        note = events.length === LIVE_CAP ? `live, first ${LIVE_CAP} events only` : "live";
      }
      days.push({ day, ...t, boards: ranked(t.boards), buys: ranked(t.buys), ...(note ? { note } : {}) });
      sum.visits += t.visits;
      sum.newPlayers += t.newPlayers;
      sum.darts += t.darts;
      sum.peakOnline = Math.max(sum.peakOnline, t.peakOnline);
      for (const [k, c] of Object.entries(t.boards)) sum.boards[k] = (sum.boards[k] ?? 0) + c;
      for (const [k, c] of Object.entries(t.buys)) sum.buys[k] = (sum.buys[k] ?? 0) + c;
    }
    return {
      now: await onlineNow(ctx),
      range: {
        days: n,
        visits: sum.visits,
        newPlayers: sum.newPlayers,
        darts: sum.darts,
        peakOnline: sum.peakOnline,
        rides: ranked(sum.boards),
        items: ranked(sum.buys),
      },
      days,
    };
  },
});
