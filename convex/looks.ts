// Avatar look options, shared by the client (picker + rendering) and the server (validation).

export const HAIR_STYLES = ["tuft", "buns", "catHood", "bow", "bearHood"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const HAIR_STYLE_NAMES: Record<HairStyle, string> = {
  tuft: "Tóc xoăn",
  buns: "Búi tóc",
  bow: "Nơ xinh",
  catHood: "Mũ mèo",
  bearHood: "Mũ gấu",
};
export const SHIRT_COLORS = ["#ff4e7a", "#ff9f1c", "#ffd166", "#06d6a0", "#2ec4b6", "#3a86ff", "#8338ec", "#f72585", "#8d99ae", "#e63946"];
export const SKIN_TONES = ["#ffcfae", "#f8bf96", "#efb07c", "#dd9a62", "#c07f4a", "#93603a"];
export const HAIR_COLORS = ["#3b2a20", "#5a3a22", "#1f1b24", "#a0663a", "#e8b44a", "#d96c4f", "#ff8fb8", "#6ea8ff"];
export const SHOE_COLORS = ["#ffffff", "#2d2d36", "#ff7eb6", "#ffd166", "#3a86ff"];

export interface Look {
  style: HairStyle;
  skin: number;
  hair: number;
  shoes: number;
}

const idx = (n: unknown, len: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < len ? n : 0);

/** Coerces anything into a valid look (unknown values fall back to the first option). */
export function cleanLook(l: { style?: unknown; skin?: unknown; hair?: unknown; shoes?: unknown } | null | undefined): Look {
  const style = HAIR_STYLES.includes(l?.style as HairStyle) ? (l!.style as HairStyle) : "tuft";
  return { style, skin: idx(l?.skin, SKIN_TONES.length), hair: idx(l?.hair, HAIR_COLORS.length), shoes: idx(l?.shoes, SHOE_COLORS.length) };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic look for players without a saved one (and for the food-cart sellers). */
export function lookFromSeed(seed: string): Look {
  const h = hash(seed);
  return {
    style: HAIR_STYLES[h % HAIR_STYLES.length],
    skin: (h >>> 3) % SKIN_TONES.length,
    hair: (h >>> 9) % 6,
    shoes: (h >>> 6) % 4,
  };
}

export function randomLook(): Look {
  return lookFromSeed(String(Math.random()));
}

export const lookKey = (l: Look) => `${l.style}/${l.skin}/${l.hair}/${l.shoes}`;
