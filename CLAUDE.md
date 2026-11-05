# Công Viên Giải Trí: notes for coding agents

Multiplayer 3D amusement park in the browser: three.js + Vite + TypeScript on the client, Convex for
shared state, Vercel hosting. Live at https://congviengiaitri.vercel.app. All player-facing text is
Vietnamese.

## Map of the code

| Path | What |
|---|---|
| `src/main.ts` | Game shell: renderer, networking (Convex), join/profile, chat, HUD, shop, darts, walking, camera, the main loop. Ride-agnostic. |
| `src/rides/` | **One file per ride** (`coaster.ts`, `wheel.ts`, `carousel.ts`, `drop.ts`, `bumper.ts`) implementing `RideDef` from `types.ts`; registered in `index.ts`. |
| `src/world/` | 3D builders/physics: `park.ts` (ground, `PATHS`, ride arch signs, trees, fence), one class per ride, `darts.ts`, `vendors.ts` (food carts + sellers). |
| `src/avatar.ts`, `src/maker.ts` | Chibi player model + poses; character picker. |
| `src/sprites.ts` | 16×16 pixel sprites. Use `{name}` tokens in UI strings (`setRich`, `makeSign`, `toast`); **never emoji**. |
| `src/audio.ts` | Synthesised sounds (`Sfx`). |
| `convex/` | `players.ts` (join/profile/position/`board`/`unboard`), `shop.ts` + `catalog.ts` (Xu wallet, carts, items), `chat.ts`, `scores.ts`, `stats.ts` (analytics), `crons.ts`, `schema.ts`. |
| `e2e/` | Headless browser checks (see Testing). |

World layout (metres; +z = south, entrance gate at z≈99): plaza (0,0); coaster NW (-100,-100…33,-54); Ferris wheel (70,-70); carousel (58,18); darts (-52,16); drop tower (0,-40); bumper cars (54,52); food carts along the avenue x=±8.5, z 40–64. Free space: south-west lawn (x -120…-20, z 30…95), east (x 90…125, z -40…95).

## How rides work

- Clock-driven rides (`coaster`, `wheel`, `carousel`, `drop`) are pure functions of `serverNow()`, so every client sees the same thing with no ride state on the server. A rider's seat is just `players.ride = { kind, key, seat, start }`; `seatPose(ride, now)` places anyone.
- Scheduled rides (`schedule` in `RideDef`: coaster, drop) get the shared queue / auto-board logic for free.
- Driven rides (`bumper`) implement `drive` (local physics), `netState` (what to stream), `follow` (place remote riders).
- `players.board` only enforces unique `(key, seat)`; it trusts the client for the rest.

### Adding a ride (checklist)
1. `src/world/<ride>.ts`: build the model (`group`, `colliders`/`boxes`, `boardZone`, `exitPoint`), motion as a function of time, `seatPose` (hip pos + quat, forward +Z).
2. `src/rides/<ride>.ts`: return a `RideDef` (label, place, zone, prompt, pick/schedule, pose, exit, camera, hud, doneToast).
3. Register it in `src/rides/index.ts`.
4. `src/world/park.ts`: add a path in `PATHS` from the main walkways to the zone, and an arch in `pathSigns` (path index).
5. `src/sprites.ts`: add a 16×16 icon (used by the place pill, minimap and sign).
6. README feature bullet.
`main.ts` should need no changes. If it does, extend `RideDef` instead of adding `if (kind === …)`.

## Analytics
- `convex/stats.ts`: mutations call `logEvent` (`join`, `new`, `board`, `buy`, `darts`) into `events`; a cron writes `snapshots` (online / riding) every 5 min; the nightly cron (00:10 Vietnam time) rolls the finished day into `daily` and prunes raw rows (events 30 days, snapshots 90). New trackable action: add a type to `logEvent` and a case in `add()`.
- Read: `npm run stats` (prod, last 7 days), `npm run stats -- '{"days":30}'`, `npm run stats:dev`. Re-run a day: `npx convex run --prod stats:rollup '{"day":"YYYY-MM-DD"}'`.
- Never log in `players.update` (runs every 110 ms per player). No IPs or user agents: profile ids only.
- Page views / visitors / referrers: Vercel Web Analytics (script injected on deployed builds only, see top of `main.ts`).

## Conventions
- UI strings in Vietnamese, sprites via `{token}`, no emoji. Keep the HUD minimal while riding (`body.riding`).
- Touch must work (left-half joystick, right-half look, buttons in `#mobileBtns`). Test both if UI changes.
- Shared state goes through Convex mutations; positions stream via `players.update` about every 110 ms.

## Testing
- `npm run typecheck`, `npm run build`.
- `npm run e2e`: starts its own Vite server and headless Chromium (software GL, `?lowgfx`), joins a player, boards every ride, plays darts, buys a snack; fails on any page error. Takes about a minute. `npm run e2e -- drop bumper` runs only some. Screenshots land in `e2e/out/` (look at them).
- `npm run e2e:bumper`: two players ram each other.
- Dev-only hooks on `window.__game`: `tp(x,z)`, `interact()`, `warp(sec)` (fast-forward the local ride clock), `nextBoarding(kind)`, `setCam`, `rides` (Map of RideDefs), world objects (`coaster`, `tower`, `bumpers`…), `openShop`, `buy`, `cartFront(i)`, `mode`, `ride`, `held`, `wallet`.
- Local dev and e2e use `.env.local`, which points to the **dev** Convex deployment. Test players never touch prod.
- Write new checks in `e2e/` with `lib.mjs` (`player`, `until`, `check`, `shot`, `finish`).

## Deploy
- Vercel deploys `main` automatically on push (production uses Convex prod `qualified-sandpiper-929`). Other branches get preview URLs.
- Convex functions are **not** auto-deployed: if `convex/` changed, run `npx convex deploy -y` before or with the push. Locally, `npx convex dev` pushes to the dev deployment and regenerates `convex/_generated`.
- The user usually ends requests with "deploy when done": push to `main` after typecheck + e2e pass.

## Working alongside other sessions
Several agent threads often run at once. Do feature work in a git worktree/branch, not in the shared checkout on `main`. Never `git add -A` blindly; stage your own files. Don't deploy a tree containing someone else's unfinished work.
