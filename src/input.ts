import { isTouch } from "./util";

export class Input {
  keys = new Set<string>();
  stickX = 0;
  stickY = 0;
  lookDX = 0;
  lookDY = 0;
  zoom = 0;
  jumpQueued = false;
  tapMode = false;
  onTap: ((x: number, y: number) => void) | null = null;
  onKey: ((code: string) => void) | null = null;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };
  private pinchDist = 0;
  private mouseDown = false;
  private stickEl = document.getElementById("stick")!;
  private knobEl = document.getElementById("knob")!;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (isTyping()) return;
      if (["Space", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        if (e.code === "Space") this.jumpQueued = true;
        this.onKey?.(e.code);
      }
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("mousedown", (e) => {
      if (isTouch && (e as any).sourceCapabilities?.firesTouchEvents) return;
      if (this.tapMode) {
        this.onTap?.(e.clientX, e.clientY);
        return;
      }
      this.mouseDown = true;
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === canvas) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      } else if (this.mouseDown) {
        this.lookDX += e.clientX - this.lastLook.x;
        this.lookDY += e.clientY - this.lastLook.y;
        this.lastLook = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener("mouseup", () => (this.mouseDown = false));
    canvas.addEventListener("wheel", (e) => {
      this.zoom += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("touchstart", (e) => this.touchStart(e), { passive: false });
    canvas.addEventListener("touchmove", (e) => this.touchMove(e), { passive: false });
    canvas.addEventListener("touchend", (e) => this.touchEnd(e), { passive: false });
    canvas.addEventListener("touchcancel", (e) => this.touchEnd(e), { passive: false });
  }

  private touchStart(e: TouchEvent) {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    for (const t of Array.from(e.changedTouches)) {
      if (this.tapMode) {
        this.onTap?.(t.clientX, t.clientY);
        continue;
      }
      if (t.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickOrigin = { x: t.clientX, y: t.clientY };
        this.stickEl.style.left = t.clientX + "px";
        this.stickEl.style.top = t.clientY + "px";
        this.knobEl.style.transform = "translate(0px,0px)";
        this.stickEl.classList.remove("hidden");
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lastLook = { x: t.clientX, y: t.clientY };
      }
    }
    if (e.touches.length === 2 && this.stickId === null) {
      const [a, b] = [e.touches[0], e.touches[1]];
      this.pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  }

  private touchMove(e: TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 2 && this.stickId === null && this.pinchDist > 0) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this.zoom += (this.pinchDist - d) / 40;
      this.pinchDist = d;
      return;
    }
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = t.clientX - this.stickOrigin.x;
        let dy = t.clientY - this.stickOrigin.y;
        const max = 55;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        this.knobEl.style.transform = `translate(${dx}px,${dy}px)`;
        this.stickX = dx / max;
        this.stickY = -dy / max;
      } else if (t.identifier === this.lookId) {
        this.lookDX += (t.clientX - this.lastLook.x) * 1.4;
        this.lookDY += (t.clientY - this.lastLook.y) * 1.4;
        this.lastLook = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private touchEnd(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.stickX = this.stickY = 0;
        this.stickEl.classList.add("hidden");
      }
      if (t.identifier === this.lookId) this.lookId = null;
    }
    if (e.touches.length < 2) this.pinchDist = 0;
  }

  /** Movement vector (x = right, y = forward), magnitude 0..1, plus run flag. */
  move() {
    let x = this.stickX, y = this.stickY;
    const k = this.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) y += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || Math.hypot(this.stickX, this.stickY) > 0.92;
    return { x, y, run, mag: Math.min(1, len) };
  }

  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY, zoom: this.zoom };
    this.lookDX = this.lookDY = this.zoom = 0;
    return r;
  }
  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }
  resetStick() {
    this.stickId = null;
    this.stickX = this.stickY = 0;
    this.stickEl.classList.add("hidden");
  }
}

export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
