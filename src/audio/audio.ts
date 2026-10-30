type Ctx = AudioContext;

/**
 * All sound is synthesised on demand — no external assets, no loading failures.
 * The context is created only after a user gesture to respect autoplay rules.
 *
 * Sound design notes:
 * - A short feedback-delay "space" send gives big events a tail.
 * - The ambient pad is a very quiet breathing drone (two detuned sines plus
 *   filtered solar-wind noise) so the observatory never sits in dead silence.
 * - The slingshot whoosh maps flyby speed to doppler pitch and loudness.
 */
export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private delay: DelayNode | null = null;
  private volumeValue = 0.55;
  private mutedValue = false;

  get volume(): number {
    return this.volumeValue;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.mutedValue ? 0 : this.volumeValue;
        this.master.connect(this.ctx.destination);
        this.noise = this.buildNoise(this.ctx);
        this.buildSpaceSend(this.ctx);
        this.startAmbient(this.ctx);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setVolume(value: number): void {
    this.volumeValue = Math.min(1, Math.max(0, value));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.mutedValue ? 0 : this.volumeValue;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  private buildNoise(ctx: Ctx): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 1.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Feedback-delay network that big voices send into for a sense of space. */
  private buildSpaceSend(ctx: Ctx): void {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.31;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const wet = ctx.createGain();
    wet.gain.value = 0.14;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.master!);
    this.delay = delay;
  }

  /** Very quiet breathing drone so the void is never dead silent. */
  private startAmbient(ctx: Ctx): void {
    const pad = ctx.createGain();
    pad.gain.value = 0.03;
    pad.connect(this.master!);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07; // breathing period ≈ 90s
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.012;
    lfo.connect(lfoDepth);
    lfoDepth.connect(pad.gain);

    for (const [freq, detune] of [
      [55, 0],
      [82.6, 5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(pad);
      osc.start();
    }
    lfo.start();

    // Solar wind: slowly drifting filtered noise, barely audible.
    if (this.noise) {
      const wind = ctx.createBufferSource();
      wind.buffer = this.noise;
      wind.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.8;
      band.frequency.value = 420;
      const wander = ctx.createOscillator();
      wander.type = 'sine';
      wander.frequency.value = 0.03;
      const wanderDepth = ctx.createGain();
      wanderDepth.gain.value = 220;
      wander.connect(wanderDepth);
      wanderDepth.connect(band.frequency);
      const windGain = ctx.createGain();
      windGain.gain.value = 0.05;
      wind.connect(band);
      band.connect(windGain);
      windGain.connect(pad);
      wind.start();
      wander.start();
    }
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    delay = 0,
    send = false,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (this.mutedValue) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.04, duration * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    if (send && this.delay) gain.connect(this.delay);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private hiss(duration: number, peak: number, frequency: number, delay = 0, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (this.mutedValue) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, t0);
    if (sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + duration);
    }
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(0.05, duration * 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.1);
  }

  /** Doppler-shaped bandpass sweep: rises toward the listener, falls away. */
  private whoosh(duration: number, peak: number, f0: number, fMid: number, f1: number, q = 1.6): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (this.mutedValue) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, fMid), t0 + duration * 0.32);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    if (this.delay) gain.connect(this.delay);
    src.start(t0);
    src.stop(t0 + duration + 0.1);
  }

  place(): void {
    this.tone(320, 520, 0.16, 'sine', 0.12);
    this.hiss(0.12, 0.035, 1800, 0, 600);
  }

  blackhole(): void {
    this.tone(180, 30, 1.3, 'sine', 0.26);
    this.tone(110, 36, 1.6, 'triangle', 0.12, 0, true);
    this.whoosh(1.4, 0.09, 1400, 500, 70, 2.4); // matter spiraling inward
  }

  supernova(): void {
    this.hiss(0.08, 0.35, 5200, 0, 900); // core crack
    this.hiss(1.9, 0.22, 1800, 0.04, 90); // fireball expansion
    this.tone(140, 24, 1.8, 'sine', 0.34); // sub-bass drop
    this.tone(700, 90, 0.7, 'sawtooth', 0.06, 0.02, true);
  }

  absorb(): void {
    this.hiss(0.16, 0.05, 2800, 0, 320);
    this.tone(520, 140, 0.14, 'triangle', 0.06);
  }

  /** Doppler whoosh scaled by the slingshot escape speed. */
  slingshot(speed: number): void {
    const t = Math.min(1, Math.max(0, (speed - 170) / 430));
    const duration = 0.45 + 0.35 * t;
    this.whoosh(duration, 0.05 + 0.1 * t, 420, 900 + 900 * t, 240, 1.8);
    this.tone(300 + 260 * t, 88, 0.4 + 0.2 * t, 'sine', 0.03 + 0.05 * t, 0, true);
  }

  /** Two bodies become one: a deep thud with a harmonised chime. */
  merge(): void {
    this.tone(90, 55, 0.5, 'sine', 0.2);
    this.tone(392, 392, 0.6, 'triangle', 0.05, 0.05, true);
    this.tone(587.33, 587.33, 0.8, 'sine', 0.035, 0.16, true);
  }

  select(): void {
    this.tone(880, 1050, 0.07, 'sine', 0.05);
  }

  deselect(): void {
    this.tone(640, 480, 0.06, 'sine', 0.04);
  }

  /** Crisp instrument tick for tool/channel changes. */
  tick(): void {
    this.tone(1250, 900, 0.04, 'triangle', 0.03);
  }

  rewind(): void {
    this.tone(180, 760, 0.5, 'sine', 0.1, 0, true);
    this.hiss(0.35, 0.04, 400, 0, 2600);
  }

  discovery(): void {
    this.tone(523.25, 523.25, 0.35, 'sine', 0.08, 0, true);
    this.tone(783.99, 783.99, 0.5, 'sine', 0.06, 0.12, true);
    this.tone(1046.5, 1046.5, 0.7, 'sine', 0.03, 0.24, true);
  }

  error(): void {
    this.tone(220, 160, 0.2, 'square', 0.05);
  }
}
