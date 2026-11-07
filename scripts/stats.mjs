// Prints park analytics (convex/stats.ts → stats:summary) as readable tables.
//   npm run stats                  prod, last 7 days
//   npm run stats -- --days 30     longer range
//   npm run stats -- --dev         dev deployment
//   npm run stats -- --json        raw JSON
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const dev = argv.includes("--dev");
const json = argv.includes("--json");
const di = argv.indexOf("--days");
const days = di >= 0 ? Number(argv[di + 1]) || 7 : 7;

const out = execFileSync(
  "npx",
  ["convex", "run", ...(dev ? [] : ["--prod"]), "stats:summary", JSON.stringify({ days })],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const s = JSON.parse(out.slice(out.indexOf("{")));
if (json) {
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

const pad = (v, n) => String(v).padStart(n);
const bar = (n, max) => "█".repeat(max ? Math.max(n ? 1 : 0, Math.round((n / max) * 24)) : 0);
function ranking(title, m) {
  const rows = Object.entries(m);
  console.log(`\n${title}`);
  if (!rows.length) return console.log("  (none yet)");
  const max = rows[0][1];
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, n] of rows) console.log(`  ${k.padEnd(w)} ${pad(n, 6)}  ${bar(n, max)}`);
}

const riding = Object.entries(s.now.riding).map(([k, n]) => `${k} ${n}`).join(", ");
console.log(`Công Viên Giải Trí · ${dev ? "dev" : "prod"} · last ${s.range.days} day(s) (Vietnam time)`);
console.log(`\nNow: ${s.now.online} online${riding ? ` · riding: ${riding}` : ""}`);
console.log(
  `Range: ${s.range.visits} visits · ${s.range.newPlayers} new players · peak ${s.range.peakOnline} online · ${s.range.darts} darts games · ${s.range.wishes ?? 0} fountain wishes`,
);
ranking("Rides by boardings", s.range.rides);
ranking("Food & items sold", s.range.items);

const kinds = Object.keys(s.range.rides);
const head = ["day", "visits", "players", "new", "peak", "darts", "wishes", "bought", ...kinds];
const rows = s.days.map((d) => [
  d.day + (d.note ? "*" : ""),
  d.visits,
  d.players,
  d.newPlayers,
  d.peakOnline,
  d.darts,
  d.wishes ?? 0,
  Object.values(d.buys).reduce((a, b) => a + b, 0),
  ...kinds.map((k) => d.boards[k] ?? 0),
]);
const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
console.log("\nPer day");
console.log("  " + head.map((h, i) => (i ? pad(h, w[i]) : h.padEnd(w[i]))).join("  "));
for (const r of rows) console.log("  " + r.map((c, i) => (i ? pad(c, w[i]) : String(c).padEnd(w[i]))).join("  "));
console.log("\n  players = unique players that day · peak = most online at once (5-min samples)");
console.log("  * counted live from raw events (today, or not rolled up yet)");
