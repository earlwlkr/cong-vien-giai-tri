import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const MAX_SCORE: Record<string, number> = { darts: 2000 };

export const submit = mutation({
  args: { id: v.id("players"), game: v.string(), score: v.number() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.id);
    if (!p) return;
    const max = MAX_SCORE[a.game];
    if (max === undefined) return;
    const score = Math.max(0, Math.min(max, Math.floor(a.score)));
    if (score <= 0) return;
    await ctx.db.insert("scores", { game: a.game, name: p.name, color: p.color, score });
  },
});

export const top = query({
  args: { game: v.string() },
  handler: async (ctx, { game }) => {
    return await ctx.db
      .query("scores")
      .withIndex("by_game_score", (q) => q.eq("game", game))
      .order("desc")
      .take(10);
  },
});
