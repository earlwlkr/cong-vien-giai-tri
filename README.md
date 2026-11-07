# 🎢 Công Viên Giải Trí

Công viên giải trí 3D nhiều người chơi chạy trên trình duyệt – **[congviengiaitri.vercel.app](https://congviengiaitri.vercel.app)**

Dạo quanh công viên, trò chuyện với mọi người và chơi các trò chơi:

- 🎢 **Tàu lượn siêu tốc** – dốc 30 m, vòng xoắn 360°, tốc độ theo vật lý thật, 2 đoàn tàu chạy theo lịch chung cho mọi người chơi
- 🎡 **Vòng quay mặt trời** – 12 cabin, ngắm toàn cảnh công viên
- 🎠 **Vòng ngựa gỗ** – có nhạc
- 🗼 **Tháp rơi tự do** – 12 ghế, vừa lên vừa xoay, treo lơ lửng 45 m rồi rơi tự do 84 km/h, phanh từ 2.9 G; mọi người cùng một lượt theo giờ máy chủ
- 🚗 **Xe điện đụng** – 8 xe, tự lái (W/S chạy, A/D lái, Space bóp còi), đụng nhau được với người chơi khác
- 🏴‍☠️ **Thuyền hải tặc** – 16 ghế, lắc như con lắc tới 70°, lơ lửng trên đỉnh mỗi nhịp; cả thuyền nhổ neo theo lịch chung
- 🪂 **Đu quay bay** – 16 ghế xích, tán dù vừa quay vừa nâng lên cao, ghế văng ra theo đúng góc lực ly tâm
- ☕ **Tách trà xoay** – 6 tách trên bàn xoay, mỗi tách tự xoay nhanh chậm, ngồi chung 4 người
- 🎯 **Ném phi tiêu** – 45 giây, bảng xếp hạng chung
- ⛲ **Đài phun nước** – ném xu ước nguyện (5 Xu, thỉnh thoảng được lì xì lại 30 Xu); mọi người thấy đồng xu bay, nước bắn tung và đồng xu nằm lại dưới đáy hồ. Cứ 90 giây đài phun nước biểu diễn một lần, cùng lúc cho mọi người
- 🪑 **Ghế đá** – ngồi nghỉ quanh quảng trường và dọc đại lộ, 2 người một ghế; đi tiếp là tự đứng dậy. Vẫy tay chào người khác (`G` / nút bàn tay)

Lần đầu vào, bạn đặt tên và tự chọn nhân vật (kiểu tóc/mũ, màu da, tóc, áo, giày). Tên, nhân vật và chỗ bạn rời công viên được lưu theo thiết bị: lần sau mở game là vào thẳng đúng chỗ cũ, không cần chọn lại. Bấm nút bút chì ở góc trên để đổi tên hoặc nhân vật.

- ❤️ **Thả cảm xúc** – tim, thích, haha, wow, buồn, ăn mừng bay lên trên đầu nhân vật cho mọi người cùng thấy (`R` / phím `1`–`6` / nút trái tim), cả khi đang ngồi trò chơi

Có góc nhìn thứ nhất / thứ ba, chat với bong bóng trên đầu nhân vật (tin nhắn tự ẩn, người mới vào chỉ thấy tin của vài phút gần đây), minimap, và điều khiển cảm ứng cho điện thoại.

## Điều khiển

| Máy tính | Điện thoại |
| --- | --- |
| `WASD` / mũi tên: di chuyển · `Shift`: chạy · `Space`: nhảy | Kéo nửa trái: cần điều khiển |
| Kéo chuột: xoay góc nhìn · lăn chuột: zoom | Kéo nửa phải: xoay góc nhìn |
| `V`: đổi góc nhìn · `E`: chơi / ngồi / ước · `Q`: rời trò chơi | 👁 đổi góc nhìn · 💬 chat · ✋ vẫy tay · ❤️ thả cảm xúc |
| `G`: vẫy tay · `R` / `1`–`6`: thả cảm xúc | |
| `Enter`: chat | |

## Công nghệ

- [three.js](https://threejs.org) + [Vite](https://vite.dev) + TypeScript
- [Convex](https://convex.dev) – hồ sơ người chơi (tên, nhân vật, vị trí cuối), vị trí người chơi, chat, bảng xếp hạng, đài phun nước ước nguyện, đồng bộ thời gian, thống kê lượt chơi (`npm run stats`)
- [Vercel](https://vercel.com) – hosting, Web Analytics

## Chạy local

```bash
npm install
npx convex dev   # tạo deployment Convex và ghi VITE_CONVEX_URL vào .env.local
npm run dev
```

## Kiểm thử

```bash
npm run typecheck
npm run e2e          # trình duyệt headless: đi hết các trò, ném phi tiêu, mua đồ ăn (~1 phút)
npm run e2e:bumper   # 2 người chơi đụng xe nhau
npm run e2e:ride-sync # người chơi khác thấy đúng vị trí khi đi bộ, khi ngồi vòng quay, sau khi tải lại
npm run e2e:plaza    # 2 người ngồi chung ghế, vẫy tay, thả cảm xúc, ném xu ước nguyện
```

Cần Chromium (`/usr/bin/chromium` hoặc biến `CHROMIUM`). Kiểm thử chạy trên một Convex backend local (miễn phí, không đụng `.env.local` hay quota cloud); `E2E_CLOUD=1` để dùng Convex dev trên cloud.

## Deploy

```bash
npx convex deploy -y
vercel deploy --prod   # cần biến môi trường VITE_CONVEX_URL trỏ tới Convex prod
```
