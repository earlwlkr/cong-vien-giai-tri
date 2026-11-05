import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cleanup stale players", { minutes: 1 }, internal.players.cleanup, {});
crons.interval("stats snapshot", { minutes: 5 }, internal.stats.snapshot, {});
// 00:10 Vietnam time: total up the day that just ended
crons.daily("stats rollup", { hourUTC: 17, minuteUTC: 10 }, internal.stats.rollup, {});
export default crons;
