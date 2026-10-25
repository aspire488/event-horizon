type Ctx = AudioContext;

/**
 * All sound is synthesised on demand — no external assets, no loading failures.
 * The context is created only after a user gesture to respect autoplay rules.
 */
export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
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

  private tone(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    delay = 0,
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

  place(): void {
    this.tone(320, 520, 0.16, 'sine', 0.12);
    this.hiss(0.12, 0.035, 1800, 0, 600);
  }

  blackhole(): void {
    this.tone(150, 34, 1.1, 'sine', 0.24);
    this.tone(92, 40, 1.4, 'triangle', 0.12);
    this.hiss(0.9, 0.08, 900, 0, 90);
  }

  supernova(): void {
    this.hiss(1.6, 0.3, 2600, 0, 140);
    this.tone(120, 28, 1.5, 'sine', 0.3);
    this.tone(420, 60, 0.5, 'sawtooth', 0.05);
  }

  absorb(): void {
    this.hiss(0.18, 0.05, 3200, 0, 380);
    this.tone(660, 220, 0.12, 'triangle', 0.05);
  }

  select(): void {
    this.tone(880, 1050, 0.07, 'sine', 0.05);
  }

  deselect(): void {
    this.tone(640, 480, 0.06, 'sine', 0.04);
  }

  rewind(): void {
    this.tone(180, 760, 0.5, 'sine', 0.1);
    this.hiss(0.35, 0.04, 400, 0, 2600);
  }

  discovery(): void {
    this.tone(523.25, 523.25, 0.35, 'sine', 0.08);
    this.tone(783.99, 783.99, 0.5, 'sine', 0.06, 0.12);
    this.tone(1046.5, 1046.5, 0.7, 'sine', 0.03, 0.24);
  }

  error(): void {
    this.tone(220, 160, 0.2, 'square', 0.05);
  }
}
