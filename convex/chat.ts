import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  args: { id: v.id("players"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const p = await ctx.db.get(id);
    if (!p) return false;
    const t = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!t) return false;
    const last = await ctx.db
      .query("messages")
      .order("desc")
      .filter((q) => q.eq(q.field("playerId"), id))
      .first();
    if (last && Date.now() - last._creationTime < 700) return false;
    await ctx.db.insert("messages", { playerId: id, name: p.name, color: p.color, text: t });
    return true;
  },
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const msgs = await ctx.db.query("messages").order("desc").take(40);
    return msgs.reverse();
  },
});
