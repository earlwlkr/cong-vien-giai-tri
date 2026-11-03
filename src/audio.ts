/** Tiny procedural sound engine (no asset files). */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  enabled = true;
  private nextNote = 0;
  private step = 0;
  private musicTimer: number | null = null;

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 100);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }

  /** level 0..1 */
  setWind(level: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, level * 0.5), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + level * 2200, t, 0.1);
  }

  /** carousel music volume 0..1 */
  setMusic(level: number) {
    if (!this.ctx) return;
    this.musicGain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.3);
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = "bandpass") {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = "sine", when = 0, out?: AudioNode) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = when || ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  clack() { this.burst(1800, 4, 0.05, 0.35); }
  pop() { this.burst(900, 0.8, 0.12, 0.9); this.burst(3000, 1, 0.06, 0.4, "highpass"); }
  whoosh() { this.burst(1200, 0.6, 0.25, 0.25); }
  /** Coins dropping into the seller's tin. */
  coin() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1976, 0.12, 0.12, "square", t);
    this.tone(2637, 0.25, 0.1, "square", t + 0.07);
    this.tone(2349, 0.2, 0.06, "triangle", t + 0.16);
  }
  munch() {
    if (!this.enabled || !this.ctx) return;
    [0, 0.13, 0.27].forEach((d) => setTimeout(() => this.burst(500 + Math.random() * 400, 1.2, 0.07, 0.5), d * 1000));
  }
  slurp() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 6;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.55);
  }
  ding() {
    if (!this.enabled) return;
    this.tone(880, 0.25, 0.2, "triangle");
    this.tone(1320, 0.35, 0.15, "triangle", (this.ctx?.currentTime ?? 0) + 0.08);
  }
  chime() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    [659, 784, 988].forEach((f, i) => this.tone(f, 0.3, 0.12, "sine", t + i * 0.09));
  }

  // simple calliope waltz for the carousel
  private scheduleMusic() {
    if (!this.ctx || this.musicGain.gain.value < 0.001) {
      if (this.ctx) this.nextNote = this.ctx.currentTime + 0.05;
      return;
    }
    const melody = [
      72, 76, 79, 76, 79, 84, 83, 79, 76, 74, 77, 81, 79, 77, 74, 72, 76, 79, 81, 79, 76, 74, 71, 74, 72, 0, 0,
    ];
    const bass = [48, 55, 55, 43, 50, 50, 41, 48, 48, 43, 50, 50];
    const beat = 0.22;
    while (this.nextNote < this.ctx.currentTime + 0.3) {
      const m = melody[this.step % melody.length];
      if (m) this.tone(440 * Math.pow(2, (m - 69) / 12), beat * 0.9, 0.5, "square", this.nextNote, this.musicGain);
      if (this.step % 3 === 0) {
        const b = bass[Math.floor(this.step / 3) % bass.length];
        this.tone(440 * Math.pow(2, (b - 69) / 12), beat * 1.2, 0.6, "triangle", this.nextNote, this.musicGain);
      }
      this.nextNote += beat;
      this.step++;
    }
  }
}
