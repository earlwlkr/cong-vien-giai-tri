import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { CARTS, XU_QUOTA, XU_REFILL_MS, cartFront, getItem } from "./catalog";
import { logEvent } from "./stats";

const validToken = (t: string) => /^[A-Za-z0-9-]{16,64}$/.test(t);

async function loadWallet(ctx: MutationCtx, token: string) {
  const w = await ctx.db.query("wallets").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (w) return w;
  const now = Date.now();
  const id = await ctx.db.insert("wallets", { token, balance: XU_QUOTA, cycleStart: now, lastBuy: 0 });
  return (await ctx.db.get(id))!;
}

/** Applies a pending 6h refill. Wallets that are already full have no running cycle. */
function refilled(w: { balance: number; cycleStart: number }, now: number) {
  if (w.balance < XU_QUOTA && now - w.cycleStart >= XU_REFILL_MS) return { balance: XU_QUOTA, cycleStart: now };
  return { balance: w.balance, cycleStart: w.cycleStart };
}

/** Creates the wallet on first visit and applies any due refill. */
export const open = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!validToken(token)) throw new Error("bad token");
    const w = await loadWallet(ctx, token);
    const r = refilled(w, Date.now());
    if (r.balance !== w.balance) await ctx.db.patch(w._id, r);
    return { balance: r.balance, cycleStart: r.cycleStart };
  },
});

/** Raw wallet; the client shows the refill countdown from cycleStart + XU_REFILL_MS. */
export const wallet = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!validToken(token)) return null;
    const w = await ctx.db.query("wallets").withIndex("by_token", (q) => q.eq("token", token)).unique();
    return w ? { balance: w.balance, cycleStart: w.cycleStart } : null;
  },
});

export const buy = mutation({
  args: { id: v.id("players"), token: v.string(), cart: v.string(), item: v.string() },
  handler: async (ctx, a) => {
    if (!validToken(a.token)) return { ok: false as const, reason: "token" };
    const p = await ctx.db.get(a.id);
    if (!p) return { ok: false as const, reason: "player" };
    const cart = CARTS.find((c) => c.id === a.cart);
    const item = getItem(a.item);
    if (!cart || !item || !cart.items.includes(a.item as never)) return { ok: false as const, reason: "item" };
    const f = cartFront(cart);
    if (p.ride || Math.hypot(p.x - f.x, p.z - f.z) > 8) return { ok: false as const, reason: "far" };

    const now = Date.now();
    const w = await loadWallet(ctx, a.token);
    if (now - w.lastBuy < 600) return { ok: false as const, reason: "fast" };
    let { balance, cycleStart } = refilled(w, now);
    if (balance < item.price) {
      await ctx.db.patch(w._id, { balance, cycleStart });
      return { ok: false as const, reason: "poor", balance };
    }
    // the 6h clock starts with the first purchase from a full wallet
    if (balance >= XU_QUOTA) cycleStart = now;
    balance -= item.price;
    await ctx.db.patch(w._id, { balance, cycleStart, lastBuy: now });
    await ctx.db.patch(a.id, { held: { item: a.item, left: item.bites }, lastSeen: now });
    await logEvent(ctx, { type: "buy", kind: a.item, profile: p.profile });
    return { ok: true as const, balance, cycleStart };
  },
});

/** One bite / sip. Balloons are let go. Returns what's left in hand. */
export const use = mutation({
  args: { id: v.id("players") },
  handler: async (ctx, { id }) => {
    const p = await ctx.db.get(id);
    if (!p?.held) return null;
    const left = p.held.left - 1;
    const held = left > 0 ? { item: p.held.item, left } : null;
    await ctx.db.patch(id, { held, lastSeen: Date.now() });
    return { item: p.held.item, left: Math.max(0, left) };
  },
});
