# Tweets: Công Viên Giải Trí

Files are in `promo/out/final/`. Each tweet below says which file to attach.
Lengths are counted the way X counts them: a Vietnamese letter with a diacritic (ạ, ế, ộ…) counts
as 2 characters, a link as 23. Every tweet is under 280 (`node promo/tweetlen.mjs promo/tweets.md`).

---

## A. Launch thread (8 tweets)

**1/8**: attach `trailer.mp4`

```tweet
Mình làm một công viên giải trí 3D chơi ngay trên trình duyệt 🎢

9 trò chơi, đài phun nước, xe đẩy bán kem. Ai vào cũng thấy nhau, ngồi chung một chuyến tàu.

Miễn phí, không cần cài, chơi cả trên điện thoại:
https://congviengiaitri.vercel.app
```

**2/8**: attach `tweet-coaster.mp4`

```tweet
Tàu lượn siêu tốc: dốc 30 m, vòng lộn 360°, tốc độ tính theo vật lý thật.

Hai đoàn tàu chạy theo giờ của máy chủ, nên lên cùng toa với bạn bè là thấy nhau la hét cùng lúc.
```

**3/8**: attach `tweet-drop.mp4`

```tweet
Tháp rơi tự do: 12 ghế, vừa lên vừa xoay, treo lơ lửng ở độ cao 45 m…

…rồi rơi 84 km/h. 😱
```

**4/8**: attach `tweet-ship.mp4`

```tweet
Mới: thuyền hải tặc 🏴‍☠️

16 ghế, mỗi nhịp lắc một cao hơn, tới 70°. Ngồi ở đầu thuyền là thấy cả bầu trời rồi cả mặt đất.
```

**5/8**: attach `tweet-swing.mp4`

```tweet
Mới: đu quay bay. Ghế treo văng ra, bay vòng quanh cột ở 48 km/h.

Nhìn xuống là thấy cả công viên, vòng quay mặt trời ngay bên cạnh.
```

**6/8**: attach `tweet-bumper.mp4`

```tweet
Xe điện đụng là trò duy nhất bạn tự lái: W/S chạy, A/D lái, Space bóp còi.

Đụng trúng xe người khác là nghe "rầm!" ngay.
```

**7/8**: attach `tweet-fountain.mp4`

```tweet
Giữa quảng trường có đài phun nước, cứ 90 giây lại biểu diễn một lần ⛲

Thả 5 Xu để ước, thỉnh thoảng được lì xì lại. Ngồi ghế đá với bạn, vẫy tay chào người lạ, thả tim bay lên đầu.
```

**8/8**: attach 4 images: `still-intro.png`, `still-ship.png`, `still-swing.png`, `still-fountain.png`

```tweet
Tự chọn nhân vật (mũ mèo, mũ gấu, búi tóc…). Game nhớ bạn đứng ở đâu, lần sau mở là vào thẳng chỗ cũ.

Làm bằng three.js + Convex. Vào chơi rồi rủ bạn bè cùng vào nhé:
https://congviengiaitri.vercel.app
```

---

## B. Standalone tweets (for later days)

**Teaser**: attach `teaser.mp4`

```tweet
30 giây ở Công Viên Giải Trí: tàu lượn, thuyền hải tặc, đu quay bay và một đám bạn ngồi bên đài phun nước 🍦

Chơi ngay trên trình duyệt, không cần tải gì:
https://congviengiaitri.vercel.app
```

**Teacups**: attach `tweet-teacups.mp4`

```tweet
Tách trà xoay: mâm xoay, tách cũng xoay, lúc nhanh lúc chậm. Bốn người một tách, rủ đủ bạn là vừa 🫖
https://congviengiaitri.vercel.app
```

**Coaster chase cam**: attach `tweet-chase.mp4`

```tweet
Cả đám giơ tay lên khi tàu lao xuống dốc 🎢

Ai đang ở trong công viên cũng thấy đúng chuyến tàu này, cùng một lúc.
https://congviengiaitri.vercel.app
```

**Food carts**: attach `tweet-plaza.mp4`

```tweet
Đói thì ghé xe đẩy: kem dâu, bắp caramel, nước mía, bánh mì, kẹo bông, bóng bay.

Mua bằng Xu trong game, cầm trên tay đi dạo, chat hiện thành bong bóng trên đầu nhân vật.
https://congviengiaitri.vercel.app
```

**Ferris wheel**: attach `tweet-wheel.mp4`

```tweet
Lên vòng quay mặt trời, đợi cabin lên tới đỉnh rồi ngắm cả công viên bên dưới. Một vòng 80 giây, đủ để chat vài câu với người ngồi cabin bên cạnh.
https://congviengiaitri.vercel.app
```

**Screenshots**: attach `still-drop.png`, `still-teacups.png`, `still-plaza.png`, `still-darts.png`

```tweet
Cuối tuần rảnh thì vào công viên chơi với mình không? Không cần vé, không cần tải app, chỉ cần một đường link 👇
https://congviengiaitri.vercel.app
```

---

## Landing page

Built at `public/gioi-thieu/` (https://congviengiaitri.vercel.app/gioi-thieu/). Media comes from
`node promo/web.mjs`. The game's `index.html` carries the same og/twitter tags, so links to the game
get the preview card too.

- Hero background: `hero-loop.mp4` (1280×720, muted, loops cleanly). Poster: `hero-poster.jpg`.
- Link preview / `og:image`: `og-image.png` (1200×630).
- Copy:
  - Tiêu đề: **Công Viên Giải Trí: công viên 3D nhiều người chơi, ngay trên trình duyệt**
  - Phụ đề: *Đi tàu lượn, lắc thuyền hải tặc, rơi từ tháp 45 m, rồi ngồi ghế đá ăn kem cùng bạn bè. Miễn phí, không cần cài đặt.*
  - Nút: **Vào công viên**
