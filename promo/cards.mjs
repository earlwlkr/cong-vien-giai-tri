// Transparent 1920x1080 overlays (title, captions, end card) for the trailer, in the style of the
// park's gate sign. Fonts: Be Vietnam Pro (OFL), from PROMO_FONTS (default ../promo-fonts).
//   node promo/cards.mjs
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(process.env.PROMO_OUT ?? path.join(root, "promo", "out"), "cards");
mkdirSync(OUT, { recursive: true });
const FONTS = process.env.PROMO_FONTS ?? path.join(root, "..", "promo-fonts");
const face = (w, file) => `@font-face { font-family: BVP; font-weight: ${w}; src: url(data:font/ttf;base64,${readFileSync(path.join(FONTS, file)).toString("base64")}); }`;
const FONT_CSS = face(600, "BeVietnamPro-SemiBold.ttf") + face(700, "BeVietnamPro-Bold.ttf") + face(800, "BeVietnamPro-ExtraBold.ttf") + face(900, "BeVietnamPro-Black.ttf");

const BASE = `${FONT_CSS}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1920px; height: 1080px; background: transparent; font-family: BVP, sans-serif; color: #fff; overflow: hidden; }
.sign { display: inline-block; background: linear-gradient(180deg, #2a1fa8, #120c5c); border-radius: 26px; padding: 34px 70px 30px;
  border: 6px solid #fff; box-shadow: 0 0 0 10px #120c5c, 0 18px 60px rgba(0,0,0,.45); position: relative; text-align: center; }
.sign::before { content: ""; position: absolute; inset: 10px; border-radius: 18px; border: 4px dotted #ffe9a8; opacity: .9; }
.gold { color: #ffd77a; text-shadow: 0 3px 0 #a8641a, 0 6px 18px rgba(0,0,0,.35); }
.star { color: #ffd77a; }
`;

const cards = {
  title: `<style>${BASE}
    body { display: flex; align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(10,10,40,.35), rgba(10,10,40,0) 65%); }
    h1 { font-weight: 900; font-size: 128px; letter-spacing: 2px; line-height: 1.05; }
    p { font-weight: 700; font-size: 40px; margin-top: 14px; }
  </style>
  <div class="sign"><h1 class="gold">CÔNG VIÊN GIẢI TRÍ</h1><p><span class="star">★</span> Công viên 3D nhiều người chơi, ngay trên trình duyệt <span class="star">★</span></p></div>`,

  end: `<style>${BASE}
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 46px; background: rgba(12,14,48,.55); }
    h1 { font-weight: 900; font-size: 112px; line-height: 1.05; }
    .sub { font-weight: 700; font-size: 42px; text-shadow: 0 3px 14px rgba(0,0,0,.5); }
    .url { font-weight: 800; font-size: 64px; background: #ff4e7a; padding: 18px 54px 22px; border-radius: 999px; box-shadow: 0 10px 0 #b8264f, 0 20px 50px rgba(0,0,0,.4); }
  </style>
  <div class="sign"><h1 class="gold">CÔNG VIÊN GIẢI TRÍ</h1></div>
  <div class="sub">Chơi miễn phí · không cần cài đặt · máy tính và điện thoại</div>
  <div class="url">congviengiaitri.vercel.app</div>`,
};

const LOWER = {
  coaster: ["Tàu lượn siêu tốc", "Dốc 30 m · vòng lộn 360° · tốc độ theo vật lý thật"],
  drop: ["Tháp rơi tự do", "Treo lơ lửng 45 m rồi rơi tự do 84 km/h"],
  wheel: ["Vòng quay mặt trời", "12 cabin · ngắm toàn cảnh công viên"],
  carousel: ["Vòng ngựa gỗ", "Có nhạc, có bạn bè"],
  bumper: ["Xe điện đụng", "Tự lái · đụng xe với người chơi khác"],
  plaza: ["Phố ẩm thực", "Kem, bắp rang, nước mía, bánh mì, bóng bay…"],
  darts: ["Ném phi tiêu", "45 giây · bảng xếp hạng chung"],
  ship: ["Thuyền hải tặc", "16 ghế · lắc tới 70°"],
  swing: ["Đu quay bay", "16 ghế treo · văng ra 60° · 48 km/h"],
  teacups: ["Tách trà xoay", "6 tách · càng xoay càng chóng mặt"],
  fountain: ["Đài phun nước", "Phun nước biểu diễn mỗi 90 giây · thả xu ước một điều"],
  together: ["Chơi cùng mọi người", "Ngồi ghế đá, vẫy tay, thả tim cho nhau"],
};
for (const [k, [t, s]] of Object.entries(LOWER)) {
  cards["lower-" + k] = `<style>${BASE}
    .lt { position: absolute; left: 80px; bottom: 90px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .t { font-weight: 900; font-size: 64px; background: linear-gradient(180deg, #2a1fa8, #120c5c); padding: 10px 34px 14px; border-radius: 18px;
      border: 4px solid #fff; box-shadow: 0 0 0 7px #120c5c, 0 12px 40px rgba(0,0,0,.4); }
    .s { font-weight: 700; font-size: 36px; background: rgba(255,78,122,.95); padding: 8px 26px 11px; border-radius: 999px; margin-left: 18px; box-shadow: 0 8px 26px rgba(0,0,0,.3); }
  </style><div class="lt"><div class="t gold">${t}</div><div class="s">${s}</div></div>`;
}
// small corner watermark for standalone clips
cards.watermark = `<style>${BASE}
  .wm { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; bottom: 30px; font-weight: 800; font-size: 34px; background: rgba(18,12,92,.82); border: 3px solid #fff;
    padding: 8px 24px 11px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
</style><div class="wm"><span class="gold">CÔNG VIÊN GIẢI TRÍ</span> · congviengiaitri.vercel.app</div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", headless: true });

// `node promo/cards.mjs og <screenshot.png> <out.png>`: 1200x630 link preview over a screenshot
if (process.argv[2] === "og") {
  const [, , , bg, out] = process.argv;
  const img = readFileSync(bg).toString("base64");
  const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE}
    html, body { width: 1200px; height: 630px; background: #000 url(data:image/png;base64,${img}) center / cover; }
    body::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,40,0) 45%, rgba(10,10,40,.55)); }
    .wrap { position: absolute; left: 0; right: 0; bottom: 44px; display: flex; flex-direction: column; align-items: center; gap: 18px; z-index: 1; }
    .sign { padding: 18px 44px 16px; border-radius: 18px; border-width: 4px; box-shadow: 0 0 0 7px #120c5c, 0 12px 40px rgba(0,0,0,.45); }
    .sign::before { inset: 7px; border-radius: 12px; border-width: 3px; }
    h1 { font-weight: 900; font-size: 64px; line-height: 1.05; }
    .sub { font-weight: 700; font-size: 27px; background: rgba(255,78,122,.96); padding: 7px 24px 10px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  </style><div class="wrap"><div class="sign"><h1 class="gold">CÔNG VIÊN GIẢI TRÍ</h1></div>
  <div class="sub">Công viên 3D nhiều người chơi · chơi ngay trên trình duyệt</div></div>`);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out });
  await browser.close();
  console.log("og image:", out);
  process.exit(0);
}

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [k, html] of Object.entries(cards)) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><body>${html}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, k + ".png"), omitBackground: true });
}
await browser.close();
console.log("cards in", OUT);
