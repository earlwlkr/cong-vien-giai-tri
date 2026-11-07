// Shared between the Convex functions (prices, positions: authoritative) and the client (visuals, menus).

/** Xu every player gets per refill. Menu items cost 5–20 Xu, so this lasts a long visit. */
export const XU_QUOTA = 300;
/** A wallet tops back up to XU_QUOTA this long after it started spending. */
export const XU_REFILL_MS = 6 * 60 * 60 * 1000;
/** A coin tossed into the plaza fountain (convex/fountain.ts). Now and then the fountain pays back. */
export const WISH_PRICE = 5;
export const WISH_LUCKY_ODDS = 1 / 12;
export const WISH_LUCKY_XU = 30;

export type ItemModel =
  | "cone" // ice cream
  | "popcorn"
  | "cup" // juice / tea with straw
  | "coconut"
  | "banhmi"
  | "cotton" // cotton candy
  | "balloon";

export interface Item {
  name: string;
  desc: string;
  price: number;
  model: ItemModel;
  /** Bites/sips until it's finished (balloons: 1 = let go). */
  bites: number;
  colors: string[];
  sprite: string;
}

export const ITEMS = {
  kem_vani: { name: "Kem vani ốc quế", desc: "Một viên vani mát lạnh", price: 10, model: "cone", bites: 4, colors: ["#fff1cf"], sprite: "icecream" },
  kem_dau: { name: "Kem dâu", desc: "Dâu tây Đà Lạt, hồng xinh", price: 10, model: "cone", bites: 4, colors: ["#ff9fb2"], sprite: "icecream" },
  kem_socola: { name: "Kem sô-cô-la 2 viên", desc: "Sô-cô-la + vani, cho người mê ngọt", price: 15, model: "cone", bites: 6, colors: ["#7a4a2a", "#fff1cf"], sprite: "icecream" },
  bap_bo: { name: "Bắp rang bơ", desc: "Nóng giòn, thơm phức mùi bơ", price: 15, model: "popcorn", bites: 6, colors: ["#fff6d8", "#e63946"], sprite: "popcorn" },
  bap_caramel: { name: "Bắp caramel", desc: "Phủ đường thắng óng ánh", price: 18, model: "popcorn", bites: 6, colors: ["#e8a54b", "#ff9f1c"], sprite: "popcorn" },
  nuoc_mia: { name: "Nước mía", desc: "Ép tại chỗ, nhiều đá", price: 10, model: "cup", bites: 4, colors: ["#c9df6b"], sprite: "drink" },
  nuoc_mia_tac: { name: "Nước mía tắc", desc: "Thêm tắc chua chua", price: 12, model: "cup", bites: 4, colors: ["#e3e05a"], sprite: "drink" },
  dua_tuoi: { name: "Dừa tươi", desc: "Nguyên trái, mát rượi", price: 20, model: "coconut", bites: 5, colors: ["#6cbf3f"], sprite: "drink" },
  bm_thit: { name: "Bánh mì thịt", desc: "Pa-tê, chả lụa, đồ chua, ngò", price: 20, model: "banhmi", bites: 5, colors: ["#d9894a"], sprite: "bread" },
  bm_trung: { name: "Bánh mì ốp la", desc: "Trứng ốp, xì dầu, dưa leo", price: 15, model: "banhmi", bites: 5, colors: ["#ffd166"], sprite: "bread" },
  tra_da: { name: "Trà đá", desc: "Ly trà đá vỉa hè chính hiệu", price: 5, model: "cup", bites: 3, colors: ["#d08a2e"], sprite: "drink" },
  keo_hong: { name: "Kẹo bông hồng", desc: "Bông xốp như mây", price: 12, model: "cotton", bites: 5, colors: ["#ff9fcf"], sprite: "candy" },
  keo_xanh: { name: "Kẹo bông xanh", desc: "Vị việt quất", price: 12, model: "cotton", bites: 5, colors: ["#8fd3ff"], sprite: "candy" },
  keo_cauvong: { name: "Kẹo bông cầu vồng", desc: "Ba màu, ba vị", price: 15, model: "cotton", bites: 6, colors: ["#ff9fcf", "#ffe48a", "#8fd3ff"], sprite: "candy" },
  bong_do: { name: "Bóng bay đỏ", desc: "Cầm đi dạo cho vui", price: 10, model: "balloon", bites: 1, colors: ["#ff4e6a"], sprite: "balloon" },
  bong_xanh: { name: "Bóng bay xanh", desc: "Cầm đi dạo cho vui", price: 10, model: "balloon", bites: 1, colors: ["#3a9bff"], sprite: "balloon" },
  bong_vang: { name: "Bóng bay vàng", desc: "Cầm đi dạo cho vui", price: 10, model: "balloon", bites: 1, colors: ["#ffcf3a"], sprite: "balloon" },
} satisfies Record<string, Item>;

export type ItemId = keyof typeof ITEMS;
export const getItem = (id: string): Item | null => (id in ITEMS ? ITEMS[id as ItemId] : null);
export const isDrink = (it: Item) => it.model === "cup" || it.model === "coconut";

export type CartKind = "kem" | "bap" | "mia" | "banhmi" | "keobong" | "bongbay";
export interface Cart {
  id: CartKind;
  /** Cart centre; the customer side is local +z, rotated by `rot`. */
  x: number;
  z: number;
  rot: number;
  title: string;
  sprite: string;
  color: string;
  seller: { name: string; color: string; hat: "nonla" | "chef" | "cap" | "none" };
  hello: string[];
  thanks: string[];
  items: ItemId[];
}

export const CARTS: Cart[] = [
  {
    id: "kem", x: -8.5, z: 40, rot: Math.PI / 2, title: "KEM TƯƠI", sprite: "icecream", color: "#ff8fab",
    seller: { name: "Cô Ba", color: "#ff8fab", hat: "nonla" },
    hello: ["Kem mát lạnh đây!", "Trời nóng ăn kem nha con!", "Kem dâu mới về nè!"],
    thanks: ["Ăn lẹ kẻo chảy nha!", "Cảm ơn con nha!"],
    items: ["kem_vani", "kem_dau", "kem_socola"],
  },
  {
    id: "bap", x: 8.5, z: 40, rot: -Math.PI / 2, title: "BẮP RANG", sprite: "popcorn", color: "#f4b400",
    seller: { name: "Chú Tư", color: "#e63946", hat: "cap" },
    hello: ["Bắp mới nổ, nóng hổi!", "Bắp bơ thơm lừng đây!"],
    thanks: ["Vừa xem vừa nhai nha!", "Cảm ơn nhiều nghen!"],
    items: ["bap_bo", "bap_caramel"],
  },
  {
    id: "mia", x: -8.5, z: 64, rot: Math.PI / 2, title: "NƯỚC MÍA", sprite: "drink", color: "#2fbf71",
    seller: { name: "Bà Năm", color: "#2fbf71", hat: "nonla" },
    hello: ["Nước mía ép liền nè!", "Uống cho đã khát nha!"],
    thanks: ["Uống từ từ kẻo sặc!", "Mát ruột chưa con?"],
    items: ["nuoc_mia", "nuoc_mia_tac", "dua_tuoi"],
  },
  {
    id: "banhmi", x: 8.5, z: 64, rot: -Math.PI / 2, title: "BÁNH MÌ", sprite: "bread", color: "#ff8c1a",
    seller: { name: "Anh Sáu", color: "#ffffff", hat: "chef" },
    hello: ["Bánh mì giòn rụm đây!", "Có trà đá free... à không, 5 Xu!"],
    thanks: ["Ngon thì ghé lại nha!", "Cảm ơn bạn nha!"],
    items: ["bm_thit", "bm_trung", "tra_da"],
  },
  {
    id: "keobong", x: 26, z: -6, rot: -Math.PI / 2 - 0.3, title: "KẸO BÔNG", sprite: "candy", color: "#c77dff",
    seller: { name: "Chị Bảy", color: "#c77dff", hat: "none" },
    hello: ["Kẹo bông như mây nè!", "Có cả cầu vồng luôn!"],
    thanks: ["Ngọt ngào nha!", "Cảm ơn bạn!"],
    items: ["keo_hong", "keo_xanh", "keo_cauvong"],
  },
  {
    id: "bongbay", x: -27, z: -5, rot: Math.PI / 2 + 0.3, title: "BÓNG BAY", sprite: "balloon", color: "#3a86ff",
    seller: { name: "Ông Tám", color: "#3a86ff", hat: "cap" },
    hello: ["Bóng bay đủ màu đây!", "Cầm cẩn thận kẻo bay mất nha!"],
    thanks: ["Đừng thả tay nha!", "Chơi vui nha con!"],
    items: ["bong_do", "bong_xanh", "bong_vang"],
  },
];

/** Where a customer stands, in world space. */
export function cartFront(c: Cart, d = 2.1) {
  return { x: c.x + Math.sin(c.rot) * d, z: c.z + Math.cos(c.rot) * d };
}
