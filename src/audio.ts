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
  /** Background music (park tune + carousel waltz) on/off; sound effects are separate (`enabled`). */
  musicOn = true;
  private bgmGain!: GainNode;
  private bgmLevel = 0;
  private carouselLevel = 0;
  private bgmNext = 0;
  private bgmStep = 0;
  private bgmLead!: GainNode;

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
    // background tune: its own bus so it can fade under the carousel and be switched off alone
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0;
    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 2600;
    this.bgmGain.connect(warm).connect(this.master);
    // lead line gets a soft echo
    this.bgmLead = ctx.createGain();
    this.bgmLead.connect(this.bgmGain);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.45;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.bgmLead.connect(echo);
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(this.bgmGain);
    this.musicTimer = window.setInterval(() => {
      this.scheduleMusic();
      this.scheduleBgm();
    }, 100);
    this.applyMusic();
  }

  /** Switch background music on/off (sound effects keep playing). */
  setMusicOn(on: boolean) {
    this.musicOn = on;
    this.applyMusic();
  }

  /** Background tune volume 0..1 (main loop: 0 before joining, lower while riding). */
  setBgm(level: number) {
    this.bgmLevel = level;
    this.applyMusic();
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

  /** carousel music volume 0..1 (by distance); the park tune fades out under it */
  setMusic(level: number) {
    this.carouselLevel = level;
    this.applyMusic();
  }

  private applyMusic() {
    if (!this.ctx || !this.bgmGain) return;
    const t = this.ctx.currentTime;
    const on = this.musicOn ? 1 : 0;
    this.musicGain.gain.setTargetAtTime(on * this.carouselLevel * 0.12, t, 0.3);
    this.bgmGain.gain.setTargetAtTime(on * this.bgmLevel * (1 - this.carouselLevel) * 0.22, t, 0.6);
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
  /** A coin plops into water. */
  splash() {
    this.burst(420, 0.9, 0.35, 0.55, "lowpass");
    this.burst(2400, 1.4, 0.18, 0.25);
    if (this.enabled && this.ctx) this.tone(1500, 0.08, 0.05, "sine", this.ctx.currentTime + 0.02);
  }
  /** Rubber-bumper thud, louder for harder hits (impact speed in m/s). */
  bump(impact: number) {
    const k = Math.min(1, impact / 6);
    this.burst(140, 1.2, 0.28, 0.35 + k * 0.6, "lowpass");
    this.burst(650, 2.5, 0.07, 0.15 + k * 0.25);
  }
  horn() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    for (const d of [0, 0.22]) {
      this.tone(440, 0.16, 0.08, "square", t + d);
      this.tone(554, 0.16, 0.06, "square", t + d);
    }
  }
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
  /** Soft bubble blip for a reaction. */
  plip() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1046, 0.12, 0.08, "sine", t);
    this.tone(1568, 0.16, 0.06, "sine", t + 0.05);
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
    if (this.nextNote < this.ctx.currentTime) this.nextNote = this.ctx.currentTime + 0.05;
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

  // ---- background park tune: a relaxed 16-bar loop in F major ----
  // Bars of eighth notes (MIDI, 0 = rest; a note lasts until the next one, up to half a bar).
  private static readonly LEAD = [
    [72, 0, 69, 0, 72, 74, 77, 0], [74, 0, 0, 72, 69, 0, 0, 0], [70, 0, 74, 0, 77, 0, 74, 72], [72, 0, 0, 0, 67, 69, 70, 0],
    [69, 0, 72, 0, 77, 0, 76, 77], [76, 0, 72, 0, 69, 0, 0, 0], [74, 0, 70, 74, 77, 0, 79, 0], [76, 0, 0, 0, 0, 0, 0, 0],
    [77, 0, 74, 0, 69, 0, 74, 0], [74, 0, 72, 70, 0, 0, 0, 0], [69, 0, 72, 0, 77, 0, 81, 0], [79, 0, 0, 76, 72, 0, 0, 0],
    [74, 0, 77, 0, 74, 0, 70, 0], [72, 0, 76, 0, 79, 0, 76, 0], [77, 0, 0, 0, 72, 0, 69, 0], [65, 0, 0, 0, 0, 0, 0, 0],
  ];
  // chord per bar: root (bass) + triad (pad)
  private static readonly CHORDS: [number, number[]][] = (() => {
    const F: [number, number[]] = [41, [53, 57, 60]], Dm: [number, number[]] = [38, [50, 53, 57]];
    const Bb: [number, number[]] = [34, [50, 53, 58]], C: [number, number[]] = [36, [52, 55, 60]];
    const Am: [number, number[]] = [33, [52, 57, 60]];
    return [F, Dm, Bb, C, F, Am, Bb, C, Dm, Bb, F, C, Bb, C, F, F];
  })();

  private midi(m: number) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /** A soft note with its own envelope (attack, hold, release) on the music bus. */
  private voice(freq: number, t: number, dur: number, vol: number, type: OscillatorType, attack: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private scheduleBgm() {
    const ctx = this.ctx;
    if (!ctx) return;
    // silent (off, before joining, or drowned by the carousel): keep the clock, schedule nothing
    if (!this.musicOn || this.bgmLevel * (1 - this.carouselLevel) < 0.02) {
      this.bgmNext = ctx.currentTime + 0.05;
      return;
    }
    if (this.bgmNext < ctx.currentTime) this.bgmNext = ctx.currentTime + 0.05; // tab was throttled: skip, don't burst
    const e = 0.3; // eighth note: 100 bpm
    const lead = Sfx.LEAD;
    const n = lead.length * 8;
    while (this.bgmNext < ctx.currentTime + 0.5) {
      const t = this.bgmNext;
      const s = this.bgmStep % n;
      const bar = Math.floor(s / 8);
      const pos = s % 8;
      const pass = Math.floor(this.bgmStep / n) % 2;
      const [root, triad] = Sfx.CHORDS[bar];
      if (pos === 0) {
        // pad: slow-swelling chord for the whole bar
        for (const m of triad) this.voice(this.midi(m), t, e * 8.4, 0.09, "triangle", 0.5, this.bgmGain);
      }
      if (pos === 0 || pos === 4) this.voice(this.midi(root), t, e * 3.6, 0.35, "sine", 0.02, this.bgmGain);
      if (pos === 6) this.voice(this.midi(root + 12), t, e * 1.6, 0.18, "sine", 0.02, this.bgmGain);
      // every other pass the first half is a broken-chord arpeggio instead of the melody
      if (pass === 1 && bar < 8) {
        if (pos % 2 === 0) {
          const m = triad[(pos / 2) % 3] + 12 + (pos === 6 ? 12 : 0);
          this.voice(this.midi(m), t, e * 2.2, 0.16, "sine", 0.01, this.bgmLead);
        }
      } else {
        const m = lead[bar][pos];
        if (m) {
          let len = 1;
          while (len < 4 && pos + len < 8 && !lead[bar][pos + len]) len++;
          const d = e * len * 0.95 + 0.15;
          // bell-ish: sine plus a quiet octave
          this.voice(this.midi(m), t, d, 0.22, "sine", 0.01, this.bgmLead);
          this.voice(this.midi(m + 12), t, d * 0.5, 0.05, "sine", 0.01, this.bgmLead);
        }
      }
      // light shaker on the off-beats
      if (pos % 2 === 1 && this.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = 6000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        src.connect(f).connect(g).connect(this.bgmGain);
        src.start(t, Math.random());
        src.stop(t + 0.1);
      }
      this.bgmNext += e;
      this.bgmStep++;
    }
  }
}
