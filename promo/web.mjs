// Web-sized media for the landing page (public/gioi-thieu/media/) from the recorded shots in
// promo/out/ (see shots.mjs, edit.mjs). Small files: 720p/540p H.264, no audio, JPEG stills.
//   node promo/web.mjs
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.PROMO_OUT ?? path.join(root, "promo", "out");
const FINAL = path.join(OUT, "final");
const DEST = path.join(root, "public", "gioi-thieu", "media");
const FONTS = process.env.PROMO_FONTS ?? path.join(root, "..", "promo-fonts");
rmSync(DEST, { recursive: true, force: true }); // no stale clips or stills from an older shot list
mkdirSync(DEST, { recursive: true });

function ff(args) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + args.join(" "));
}
const H264 = (crf) => ["-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];

// trailer, 720p
ff(["-i", path.join(FINAL, "trailer.mp4"), "-vf", "scale=1280:720:flags=lanczos", ...H264(31), path.join(DEST, "trailer.mp4")]);
ff(["-ss", "5.5", "-i", path.join(FINAL, "trailer.mp4"), "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", "-q:v", "3", path.join(DEST, "trailer-poster.jpg")]);

// hero background loop (already 720p and small)
copyFileSync(path.join(FINAL, "hero-loop.mp4"), path.join(DEST, "hero-loop.mp4"));
copyFileSync(path.join(FINAL, "hero-poster.jpg"), path.join(DEST, "hero-poster.jpg"));
copyFileSync(path.join(FINAL, "og-image.png"), path.join(DEST, "og-image.png"));

// one short looping clip per feature card: [name, raw shot, start, seconds]
const CLIPS = [
  ["coaster", "coaster-pov", 1.2, 6],
  ["drop", "drop-pov", 1.5, 6],
  ["ship", "ship", 2, 6],
  ["swing", "swing", 3, 6],
  ["wheel", "wheel-top", 0.5, 6],
  ["carousel", "carousel", 1, 6],
  ["teacups", "teacups", 1, 6],
  ["bumper", "bumper", 1, 6],
  ["darts", "darts", 0, 5.5],
  ["fountain", "fountain", 0.5, 10],
];
for (const [name, shot, ss, t] of CLIPS) {
  const src = path.join(OUT, shot + ".mp4");
  ff(["-ss", String(ss), "-t", String(t), "-i", src, "-vf", "scale=960:540:flags=lanczos", ...H264(27), path.join(DEST, `clip-${name}.mp4`)]);
  ff(["-ss", String(ss), "-i", src, "-frames:v", "1", "-vf", "scale=960:540:flags=lanczos", "-q:v", "4", path.join(DEST, `clip-${name}.jpg`)]);
}

// gallery stills: 1600 wide JPEG
const GALLERY = ["intro", "gate", "coaster", "coaster-riders", "drop-ground", "ship", "swing", "teacups", "wheel-top", "fountain", "plaza", "outro"];
for (const n of GALLERY) {
  ff(["-i", path.join(FINAL, `still-${n}.png`), "-vf", "scale=1600:-2:flags=lanczos", "-q:v", "3", path.join(DEST, `still-${n}.jpg`)]);
}

// fonts (Be Vietnam Pro, OFL)
for (const f of ["BeVietnamPro-SemiBold.ttf", "BeVietnamPro-Bold.ttf", "BeVietnamPro-Black.ttf"]) copyFileSync(path.join(FONTS, f), path.join(DEST, f));

let total = 0;
for (const f of readdirSync(DEST)) total += statSync(path.join(DEST, f)).size;
console.log(`media in ${DEST}: ${(total / 1e6).toFixed(1)} MB`);
