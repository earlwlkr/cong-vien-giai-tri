# Tweets: Công Viên Giải Trí

Files are in `promo/out/final/`. Each tweet below says which file to attach.
Lengths are counted the way X counts them: a Vietnamese letter with a diacritic (ạ, ế, ộ…) counts
as 2 characters, a link as 23. Every tweet is under 280 (`node promo/tweetlen.mjs promo/tweets.md`).

---

## A. Launch thread (6 tweets)

**1/6**: attach `trailer.mp4`

```tweet
Mình làm một công viên giải trí 3D chơi ngay trên trình duyệt 🎢

Tàu lượn, tháp rơi, vòng quay, ngựa gỗ, xe đụng, phi tiêu. Ai vào cũng thấy nhau, ngồi chung một chuyến tàu.

Miễn phí, không cần cài, chơi cả trên điện thoại:
https://congviengiaitri.vercel.app
```

**2/6**: attach `tweet-coaster.mp4`

```tweet
Tàu lượn siêu tốc: dốc 30 m, vòng lộn 360°, tốc độ tính theo vật lý thật.

Hai đoàn tàu chạy theo giờ của máy chủ, nên lên cùng toa với bạn bè là thấy nhau la hét cùng lúc.
```

**3/6**: attach `tweet-drop.mp4`

```tweet
Tháp rơi tự do: 12 ghế, vừa lên vừa xoay, treo lơ lửng ở độ cao 45 m…

…rồi rơi 84 km/h. 😱
```

**4/6**: attach `tweet-bumper.mp4`

```tweet
Xe điện đụng là trò duy nhất bạn tự lái: W/S chạy, A/D lái, Space bóp còi.

Đụng trúng xe người khác là nghe "rầm!" ngay.
```

**5/6**: attach `tweet-plaza.mp4`

```tweet
Đói thì ghé xe đẩy: kem dâu, bắp caramel, nước mía, bánh mì, kẹo bông, bóng bay.

Mua bằng Xu trong game, cầm trên tay đi dạo, chat hiện thành bong bóng trên đầu nhân vật.
```

**6/6**: attach 4 images: `still-intro.png`, `still-coaster.png`, `still-wheel.png`, `still-carousel.png`

```tweet
Tự chọn nhân vật (mũ mèo, mũ gấu, búi tóc…). Game nhớ bạn đứng ở đâu, lần sau mở là vào thẳng chỗ cũ.

Làm bằng three.js + Convex. Vào chơi rồi rủ bạn bè cùng vào nhé:
https://congviengiaitri.vercel.app
```

---

## B. Standalone tweets (for later days)

**Teaser**: attach `teaser.mp4`

```tweet
25 giây ở Công Viên Giải Trí: tàu lượn, tháp rơi, xe đụng và một đám bạn ăn kem ngoài quảng trường 🍦

Chơi ngay trên trình duyệt, không cần tải gì:
https://congviengiaitri.vercel.app
```

**Coaster chase cam**: attach `tweet-chase.mp4`

```tweet
Cả đám giơ tay lên khi tàu lao xuống dốc 🎢

Ai đang ở trong công viên cũng thấy đúng chuyến tàu này, cùng một lúc.
https://congviengiaitri.vercel.app
```

**Ferris wheel**: attach `tweet-wheel.mp4`

```tweet
Lên vòng quay mặt trời, đợi cabin lên tới đỉnh rồi ngắm cả công viên bên dưới. Một vòng 80 giây, đủ để chat vài câu với người ngồi cabin bên cạnh.
https://congviengiaitri.vercel.app
```

**Screenshots**: attach `still-drop.png`, `still-bumper.png`, `still-plaza.png`, `still-darts.png`

```tweet
Cuối tuần rảnh thì vào công viên chơi với mình không? Không cần vé, không cần tải app, chỉ cần một đường link 👇
https://congviengiaitri.vercel.app
```

---

## Landing page

Built at `public/gioi-thieu/` (https://congviengiaitri.vercel.app/gioi-thieu/ once deployed). The game's
`index.html` now carries the same og/twitter tags, so links to the game get the preview card too.

- Hero background: `hero-loop.mp4` (1280×720, muted, loops cleanly). Poster: `hero-poster.jpg`.
  `<video autoplay muted loop playsinline poster="hero-poster.jpg" src="hero-loop.mp4"></video>`
- Link preview / `og:image`: `og-image.png` (1200×630).
- Feature screenshots: the `still-*.png` files (1920×1080).
- Copy ideas:
  - Tiêu đề: **Công Viên Giải Trí: công viên 3D nhiều người chơi, ngay trên trình duyệt**
  - Phụ đề: *Đi tàu lượn, rơi từ tháp 45 m, lái xe đụng và ăn kem cùng bạn bè. Miễn phí, không cần cài đặt.*
  - Nút: **Vào công viên**
