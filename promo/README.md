# Promo capture

Renders trailer footage of the real game, frame by frame, against a **local** Convex backend
(`e2e/convex-local.mjs`, free; `E2E_CLOUD=1` uses the dev cloud deployment).

- `lib.mjs`: harness. Playwright's fake clock steps exactly one game frame per video frame
  (1920×1080, 30 fps, smooth even on software GL), scripted bot players (`bots`) send positions
  when they move (5 s real-time heartbeat otherwise),
  board rides and chat on the same virtual clock, and in-page camera helpers (`__cam.path`, `orbit`,
  `follow`, `track`) drive the DEV-only `__game.cine` hook in `src/main.ts`.
- `shots.mjs`: the shot list. Writes `out/<shot>.mp4` plus PNG stills.
  `node promo/shots.mjs coaster drop` runs some shots. `TAKES=drop-ground node promo/shots.mjs drop`
  re-records one take and plays through the others.
- `cards.mjs`: title, caption and end-card overlays (Be Vietnam Pro, OFL; set `PROMO_FONTS`).
  `node promo/cards.mjs og <png> <out>` makes the 1200×630 link preview.
- `edit.mjs`: cuts `out/final/` (trailer, teaser, tweet clips, landing-page hero loop) with ffmpeg.
- `web.mjs`: web-sized copies (720p trailer, short ride clips, JPEG stills, fonts) into
  `public/gioi-thieu/media/` for the landing page at `/gioi-thieu/` (`public/gioi-thieu/index.html`,
  plain static HTML and CSS, copied into `dist/` as is).
- `tweets.md`: tweet copy in Vietnamese. `node promo/tweetlen.mjs promo/tweets.md` checks lengths
  the way X counts them (letters with diacritics count 2).

Needs `ffmpeg` and Chromium. Reuse a running dev server with `E2E_URL=http://127.0.0.1:5173/`.
Rendering everything takes about 40 min.
