import type { SpriteName } from "./sprites";

/** Quick reactions (R / 1-6 / the heart button): a sprite floats up over your head for everyone. */
export const REACTIONS: { sprite: SpriteName; label: string }[] = [
  { sprite: "heart", label: "Thả tim" },
  { sprite: "like", label: "Thích" },
  { sprite: "haha", label: "Haha" },
  { sprite: "wow", label: "Wow" },
  { sprite: "sad", label: "Buồn" },
  { sprite: "party", label: "Ăn mừng" },
];

/** How long a reaction stays in the streamed anim (long enough for a heartbeat-free send to land). */
export const REACT_STREAM_MS = 2000;
/** Fastest a player can send reactions. */
export const REACT_GAP_MS = 350;

/**
 * The streamed `anim` is the pose plus optional flags: `+w` while waving, `+r<kind><n>` for a reaction
 * (`n` is a 0-9 counter so the same reaction twice in a row still reads as new), e.g. `walk+w+r27`.
 * players.update keeps only 12 chars: poses are at most 5 ("bench"), so `bench+w+r27` (11) still fits.
 */
export function parseAnim(anim: string): { base: string; waving: boolean; react: string | null } {
  const parts = anim.split("+");
  let waving = false;
  let react: string | null = null;
  for (const p of parts.slice(1)) {
    if (p === "w") waving = true;
    else if (/^r\d\d$/.test(p)) react = p;
  }
  return { base: parts[0], waving, react };
}

/** Sprite of a `react` token from parseAnim, if it names a known reaction. */
export function reactionSprite(token: string): SpriteName | null {
  return REACTIONS[+token[1]]?.sprite ?? null;
}
