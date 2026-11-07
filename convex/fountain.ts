import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { WISH_LUCKY_ODDS, WISH_LUCKY_XU, WISH_PRICE, XU_QUOTA } from "./catalog";
import { loadWallet, refilled } from "./shop";
import { posOf } from "./players";
import { logEvent } from "./stats";

const validToken = (t: string) => /^[A-Za-z0-9-]{16,64}$/.test(t);
/** Stand around the flower bed (radius 8.6) to reach the water. */
const REACH = 13;

/** Wish count (coins in the basin) and the latest wish, which every client plays. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const f = await ctx.db.query("fountain").first();
    return { count: f?.count ?? 0, last: f?.last ?? null };
  },
});

/** Toss a coin (WISH_PRICE Xu) into the fountain and make a wish. Sometimes it pays back. */
export const wish = mutation({
  args: { id: v.id("players"), token: v.string() },
  handler: async (ctx, a) => {
    if (!validToken(a.token)) return { ok: false as const, reason: "token" };
    const p = await ctx.db.get(a.id);
    if (!p) return { ok: false as const, reason: "player" };
    const pos = await posOf(ctx, p._id);
    if (p.ride || !pos || Math.hypot(pos.x, pos.z) > REACH) return { ok: false as const, reason: "far" };

    const now = Date.now();
    const w = await loadWallet(ctx, a.token);
    if (now - (w.lastWish ?? 0) < 2000) return { ok: false as const, reason: "fast" };
    let { balance, cycleStart } = refilled(w, now);
    if (balance < WISH_PRICE) {
      await ctx.db.patch(w._id, { balance, cycleStart });
      return { ok: false as const, reason: "poor", balance };
    }
    // same as a purchase: the 6h clock starts with the first spend from a full wallet
    if (balance >= XU_QUOTA) cycleStart = now;
    balance -= WISH_PRICE;
    const lucky = Math.random() < WISH_LUCKY_ODDS;
    if (lucky) balance += WISH_LUCKY_XU;
    await ctx.db.patch(w._id, { balance, cycleStart, lastWish: now });

    const last = { player: p._id, name: p.name, x: pos.x, z: pos.z, at: now, lucky };
    const f = await ctx.db.query("fountain").first();
    const count = (f?.count ?? 0) + 1;
    if (f) await ctx.db.patch(f._id, { count, last });
    else await ctx.db.insert("fountain", { count, last });
    await logEvent(ctx, { type: "wish", profile: p.profile });
    return { ok: true as const, balance, cycleStart, lucky, count };
  },
});
