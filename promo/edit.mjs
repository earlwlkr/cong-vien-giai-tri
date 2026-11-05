// Cuts the recorded shots (promo/shots.mjs) and cards (promo/cards.mjs) into finished videos:
//   trailer.mp4   ~1 min, captions + title + end card
//   teaser.mp4    ~20 s for a tweet
//   tweet-*.mp4   single shots with a corner watermark
//   hero-loop.mp4 720p, muted, seamless-ish loop for the landing page (+ hero-poster.jpg)
//   node promo/edit.mjs [trailer|teaser|tweets|hero]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.PROMO_OUT ?? path.join(root, "promo", "out");
const FINAL = path.join(OUT, "final");
mkdirSync(FINAL, { recursive: true });
const clip = (n) => path.join(OUT, n + ".mp4");
const card = (n) => path.join(OUT, "cards", n + ".png");
const FADE = 0.5;
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

function ff(args) {
  console.log("ffmpeg", args.filter((a) => a.endsWith(".mp4")).slice(-1)[0] ?? "");
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
}
const X264 = ["-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30"];

/**
 * Segments: { clip, ss, t, cards: [{ name, at, dur }] }. Cross-fades between segments; fades in
 * from and out to black at the ends.
 */
function cut(segs, out) {
  const args = [], f = [];
  let n = 0;
  const labels = [];
  segs.forEach((s, i) => {
    if (!existsSync(clip(s.clip))) throw new Error("missing " + clip(s.clip));
    args.push("-ss", String(s.ss), "-t", String(s.t), "-i", clip(s.clip));
    const vi = n++;
    let cur = `[${vi}:v]settb=1/30,setpts=PTS-STARTPTS,fps=30,format=yuv420p`;
    let lab = `v${i}`;
    f.push(`${cur}[${lab}]`);
    (s.cards ?? []).forEach((c, j) => {
      args.push("-loop", "1", "-t", String(s.t), "-i", card(c.name));
      const ci = n++;
      const end = Math.min(s.t, c.at + (c.dur ?? s.t));
      f.push(`[${ci}:v]format=rgba,fade=in:st=${c.at}:d=0.35:alpha=1,fade=out:st=${Math.max(c.at, end - 0.4)}:d=0.4:alpha=1[c${i}_${j}]`);
      f.push(`[${lab}][c${i}_${j}]overlay=0:0:shortest=1,format=yuv420p[${lab}o${j}]`);
      lab = `${lab}o${j}`;
    });
    labels.push(lab);
  });
  // chain cross-fades
  let acc = labels[0], t = segs[0].t;
  for (let i = 1; i < labels.length; i++) {
    const off = t - FADE;
    f.push(`[${acc}][${labels[i]}]xfade=transition=fade:duration=${FADE}:offset=${off.toFixed(3)}[x${i}]`);
    acc = `x${i}`;
    t = off + segs[i].t;
  }
  f.push(`[${acc}]fade=in:st=0:d=0.6,fade=out:st=${(t - 0.8).toFixed(3)}:d=0.8[out]`);
  ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", ...X264, out]);
  console.log(`  ${path.basename(out)}: ${t.toFixed(1)} s`);
}

const lower = (name, at = 0.4, dur = 3.6) => ({ name: "lower-" + name, at, dur });

if (want("trailer")) {
  cut([
    { clip: "intro", ss: 0, t: 10, cards: [{ name: "title", at: 4.6, dur: 4.6 }] },
    { clip: "coaster-pov", ss: 0.3, t: 7.5, cards: [lower("coaster", 0.6, 4)] },
    { clip: "coaster-chase", ss: 2.3, t: 4.3 },
    { clip: "coaster-loop", ss: 1.5, t: 3.5 },
    { clip: "drop-pov", ss: 1, t: 6.5, cards: [lower("drop", 0.4, 3.6)] },
    { clip: "drop-ground", ss: 5, t: 4.5 },
    { clip: "wheel", ss: 0.5, t: 4.5, cards: [lower("wheel")] },
    { clip: "wheel-top", ss: 1, t: 4 },
    { clip: "carousel", ss: 1, t: 5, cards: [lower("carousel")] },
    { clip: "bumper", ss: 1, t: 7.5, cards: [lower("bumper", 0.4, 4)] },
    { clip: "plaza", ss: 0.2, t: 8.5, cards: [lower("plaza", 0.4, 3.6), lower("together", 4.6, 3.6)] },
    { clip: "darts", ss: 0.2, t: 5, cards: [lower("darts")] },
    { clip: "outro", ss: 0, t: 9, cards: [{ name: "end", at: 2.2 }] },
  ], path.join(FINAL, "trailer.mp4"));
}

if (want("teaser")) {
  cut([
    { clip: "intro", ss: 3.2, t: 5, cards: [{ name: "title", at: 1.3, dur: 3.5 }] },
    { clip: "coaster-pov", ss: 1.5, t: 4.5 },
    { clip: "coaster-chase", ss: 3, t: 3.2 },
    { clip: "drop-pov", ss: 2.5, t: 3.5 },
    { clip: "bumper", ss: 2, t: 3.5 },
    { clip: "plaza", ss: 1, t: 3 },
    { clip: "outro", ss: 2, t: 5, cards: [{ name: "end", at: 0.6 }] },
  ], path.join(FINAL, "teaser.mp4"));
}

if (want("tweets")) {
  // one clip per tweet in the thread, watermarked
  const T = [["coaster", ["coaster-pov", 0, 11]], ["drop", ["drop-pov", 0, 9]], ["bumper", ["bumper", 0, 11]], ["plaza", ["plaza", 0, 9.5]], ["wheel", ["wheel-top", 0, 7]], ["chase", ["coaster-chase", 0, 6.6]]];
  for (const [name, [c, ss, t]] of T) {
    if (!existsSync(clip(c))) { console.log("skip", c); continue; }
    ff(["-ss", String(ss), "-t", String(t), "-i", clip(c), "-i", card("watermark"),
      "-filter_complex", `[0:v][1:v]overlay=0:0,fade=in:st=0:d=0.3,fade=out:st=${t - 0.4}:d=0.4[o]`, "-map", "[o]", ...X264, path.join(FINAL, `tweet-${name}.mp4`)]);
  }
}

if (want("hero")) {
  // landing page background: slow aerial, 720p, small file, crossfaded with its own start to loop
  const src = clip("outro"), d = 9.5, xf = 1.5;
  // plays src[xf..d], fading its tail into src[0..xf]: the last frame continues into the first
  ff(["-ss", String(xf), "-t", String(d - xf), "-i", src, "-t", String(xf), "-i", src, "-filter_complex",
    `[0:v]settb=1/30,setpts=PTS-STARTPTS,fps=30,scale=1280:720:flags=lanczos,format=yuv420p[a];[1:v]settb=1/30,setpts=PTS-STARTPTS,fps=30,scale=1280:720:flags=lanczos,format=yuv420p[b];[a][b]xfade=transition=fade:duration=${xf}:offset=${d - 2 * xf}[o]`,
    "-map", "[o]", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", path.join(FINAL, "hero-loop.mp4")]);
  ff(["-i", path.join(FINAL, "hero-loop.mp4"), "-frames:v", "1", "-q:v", "3", path.join(FINAL, "hero-poster.jpg")]);
}
