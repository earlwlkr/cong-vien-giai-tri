# 🎢 Công Viên Giải Trí

Công viên giải trí 3D nhiều người chơi chạy trên trình duyệt – **[congviengiaitri.vercel.app](https://congviengiaitri.vercel.app)**

Dạo quanh công viên, trò chuyện với mọi người và chơi các trò chơi:

- 🎢 **Tàu lượn siêu tốc** – dốc 30 m, vòng xoắn 360°, tốc độ theo vật lý thật, 2 đoàn tàu chạy theo lịch chung cho mọi người chơi
- 🎡 **Vòng quay mặt trời** – 12 cabin, ngắm toàn cảnh công viên
- 🎠 **Vòng ngựa gỗ** – có nhạc
- 🎯 **Ném phi tiêu** – 45 giây, bảng xếp hạng chung

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
- [Convex](https://convex.dev) – vị trí người chơi, chat, bảng xếp hạng, đồng bộ thời gian
- [Vercel](https://vercel.com) – hosting

## Chạy local

```bash
npm install
npx convex dev   # tạo deployment Convex và ghi VITE_CONVEX_URL vào .env.local
npm run dev
```

## Deploy

```bash
npx convex deploy -y
vercel deploy --prod   # cần biến môi trường VITE_CONVEX_URL trỏ tới Convex prod
```
