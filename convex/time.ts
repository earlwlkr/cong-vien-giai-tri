import { mutation } from "./_generated/server";

/** Used by clients to sync their clock with the server (rides run on a shared schedule). */
export const now = mutation({
  args: {},
  handler: async () => Date.now(),
});
