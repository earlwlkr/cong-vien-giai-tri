// X/Twitter weighted length: code points in 0-4351, 8192-8205, 8208-8223, 8242-8247 count 1, everything
// else (incl. Vietnamese letters with diacritics, U+1EA0-1EF9) counts 2; URLs count 23; NFC first.
//   node promo/tweetlen.mjs file.md   -> lengths of each ```tweet block
import { readFileSync } from "node:fs";
export function weighted(text) {
  let t = text.normalize("NFC"), n = 0;
  t = t.replace(/https?:\/\/\S+/g, () => ((n += 23), ""));
  for (const ch of t) {
    const c = ch.codePointAt(0);
    n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2;
  }
  return n;
}
const md = readFileSync(process.argv[2], "utf8");
const blocks = [...md.matchAll(/```tweet\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
blocks.forEach((b, i) => console.log(`${i + 1}: ${weighted(b)}/280 ${weighted(b) > 280 ? "TOO LONG" : ""}  ${b.split("\n")[0].slice(0, 50)}`));
