# 🎢 Công Viên Giải Trí

Công viên giải trí 3D nhiều người chơi chạy trên trình duyệt – **[congviengiaitri.vercel.app](https://congviengiaitri.vercel.app)**

Dạo quanh công viên, trò chuyện với mọi người và chơi các trò chơi:

- 🎢 **Tàu lượn siêu tốc** – dốc 30 m, vòng xoắn 360°, tốc độ theo vật lý thật, 2 đoàn tàu chạy theo lịch chung cho mọi người chơi
- 🎡 **Vòng quay mặt trời** – 12 cabin, ngắm toàn cảnh công viên
- 🎠 **Vòng ngựa gỗ** – có nhạc
- 🗼 **Tháp rơi tự do** – 12 ghế, vừa lên vừa xoay, treo lơ lửng 45 m rồi rơi tự do 84 km/h, phanh từ 2.9 G; mọi người cùng một lượt theo giờ máy chủ
- 🚗 **Xe điện đụng** – 8 xe, tự lái (W/S chạy, A/D lái, Space bóp còi), đụng nhau được với người chơi khác
- 🎯 **Ném phi tiêu** – 45 giây, bảng xếp hạng chung

Lần đầu vào, bạn đặt tên và tự chọn nhân vật (kiểu tóc/mũ, màu da, tóc, áo, giày). Tên, nhân vật và chỗ bạn rời công viên được lưu theo thiết bị: lần sau mở game là vào thẳng đúng chỗ cũ, không cần chọn lại. Bấm nút bút chì ở góc trên để đổi tên hoặc nhân vật.

Có góc nhìn thứ nhất / thứ ba, chat với bong bóng trên đầu nhân vật, minimap, và điều khiển cảm ứng cho điện thoại.

## Điều khiển

| Máy tính | Điện thoại |
| --- | --- |
| `WASD` / mũi tên: di chuyển · `Shift`: chạy · `Space`: nhảy | Kéo nửa trái: cần điều khiển |
| Kéo chuột: xoay góc nhìn · lăn chuột: zoom | Kéo nửa phải: xoay góc nhìn |
| `V`: đổi góc nhìn · `E`: chơi · `Q`: rời trò chơi | 👁 đổi góc nhìn · 💬 chat |
| `Enter`: chat | |

## Công nghệ

- [three.js](https://threejs.org) + [Vite](https://vite.dev) + TypeScript
- [Convex](https://convex.dev) – hồ sơ người chơi (tên, nhân vật, vị trí cuối), vị trí người chơi, chat, bảng xếp hạng, đồng bộ thời gian
- [Vercel](https://vercel.com) – hosting

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
```

Cần Chromium (`/usr/bin/chromium` hoặc biến `CHROMIUM`). Dùng Convex dev trong `.env.local`.

## Deploy

```bash
npx convex deploy -y
vercel deploy --prod   # cần biến môi trường VITE_CONVEX_URL trỏ tới Convex prod
```
