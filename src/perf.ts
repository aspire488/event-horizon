/** Percentile of a sample set (0..1). Mutates a sorted copy, not the input. */
export function percentileOf(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

export interface PerfSnapshot {
  /** Frames per second over the last half-second window. */
  fps: number;
  /** Exponentially smoothed frame time in ms. */
  frameMs: number;
  /** Frame-time percentiles over the retained ring buffer. */
  p50: number;
  p95: number;
  p99: number;
  /** Worst single frame retained in the buffer (ms). */
  worstMs: number;
  /** Number of frames currently retained (≤ buffer capacity). */
  samples: number;
  /** Smoothed simulation time per frame (ms). */
  physicsMs: number;
  /** Smoothed render time per frame (ms). */
  renderMs: number;
}

export class PerfMonitor {
  fps = 0;
  frameMs = 0;
  physicsMs = 0;
  renderMs = 0;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private readonly ring: Float64Array;
  private ringCount = 0;
  private ringNext = 0;

  constructor(capacity = 360) {
    this.ring = new Float64Array(Math.max(30, capacity));
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.frames += 1;
    this.elapsed += dt;
    const instant = dt * 1000;
    this.frameMs = this.frameMs === 0 ? instant : this.frameMs * 0.9 + instant * 0.1;
    this.worst = Math.max(this.worst, instant);
    this.ring[this.ringNext] = instant;
    this.ringNext = (this.ringNext + 1) % this.ring.length;
    if (this.ringCount < this.ring.length) this.ringCount += 1;
    if (this.elapsed >= 0.5) {
      this.fps = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
  }

  /** Records the simulation/render split for the current frame (ms, smoothed). */
  recordSections(physicsMs: number, renderMs: number): void {
    if (Number.isFinite(physicsMs) && physicsMs >= 0) {
      this.physicsMs = this.physicsMs * 0.9 + physicsMs * 0.1;
    }
    if (Number.isFinite(renderMs) && renderMs >= 0) {
      this.renderMs = this.renderMs * 0.9 + renderMs * 0.1;
    }
  }

  /** Retained frame-time samples in chronological order (ms). */
  samples(): number[] {
    const out: number[] = [];
    const start = (this.ringNext - this.ringCount + this.ring.length) % this.ring.length;
    for (let i = 0; i < this.ringCount; i++) out.push(this.ring[(start + i) % this.ring.length]);
    return out;
  }

  percentile(p: number): number {
    return percentileOf(this.samples(), p);
  }

  get worstMs(): number {
    return this.worst;
  }

  resetWorst(): void {
    this.worst = 0;
  }

  /** Clears retained frame times (used between benchmark phases). */
  resetSamples(): void {
    this.ringCount = 0;
    this.ringNext = 0;
    this.worst = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.physicsMs = 0;
    this.renderMs = 0;
    this.frames = 0;
    this.elapsed = 0;
  }

  snapshot(): PerfSnapshot {
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      p50: this.percentile(0.5),
      p95: this.percentile(0.95),
      p99: this.percentile(0.99),
      worstMs: this.worst,
      samples: this.ringCount,
      physicsMs: this.physicsMs,
      renderMs: this.renderMs,
    };
  }

  /** A simple, honest hint: sustained low FPS suggests dropping quality. */
  suggestsLowerQuality(): boolean {
    return this.fps > 0 && this.fps < 42;
  }
}

export type QualityStep = 'up' | 'down';

export interface AdaptiveOptions {
  /** Drop a tier when window p95 exceeds this (ms). ~20ms ≈ 50fps sustained. */
  dropAboveMs: number;
  /** Raise a tier when window p95 stays under this (ms). Comfortable 60fps headroom. */
  raiseBelowMs: number;
  /** Frames per evaluation window. */
  windowFrames: number;
  /** Consecutive over-budget windows required before dropping. */
  dropAfter: number;
  /** Consecutive under-budget windows required before raising. */
  raiseAfter: number;
  /** Minimum time between tier changes (ms) — prevents oscillation. */
  cooldownMs: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = {
  dropAboveMs: 20,
  raiseBelowMs: 13.5,
  windowFrames: 60,
  dropAfter: 2,
  raiseAfter: 10,
  cooldownMs: 4000,
};

/**
 * Frame-time driven tier controller with hysteresis and cooldown.
 * Rendering-only: it suggests 'up'/'down' steps and never touches world state,
 * so quality changes can never alter the simulation.
 */
export class AdaptiveQuality {
  private readonly opts: AdaptiveOptions;
  private window: number[] = [];
  private bad = 0;
  private good = 0;
  private lastChangeMs = Number.NEGATIVE_INFINITY;

  constructor(opts: Partial<AdaptiveOptions> = {}) {
    this.opts = { ...DEFAULT_ADAPTIVE, ...opts };
  }

  reset(): void {
    this.window = [];
    this.bad = 0;
    this.good = 0;
    this.lastChangeMs = Number.NEGATIVE_INFINITY;
  }

  /** Feed one frame; returns a tier step when the controller decides to change. */
  nextFrame(frameMs: number, nowMs: number): QualityStep | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return null;
    this.window.push(frameMs);
    if (this.window.length < this.opts.windowFrames) return null;
    const p95 = percentileOf(this.window, 0.95);
    this.window = [];

    if (nowMs - this.lastChangeMs < this.opts.cooldownMs) {
      this.bad = 0;
      this.good = 0;
      return null;
    }
    if (p95 > this.opts.dropAboveMs) {
      this.bad += 1;
      this.good = 0;
      if (this.bad >= this.opts.dropAfter) {
        this.bad = 0;
        this.lastChangeMs = nowMs;
        return 'down';
      }
    } else if (p95 < this.opts.raiseBelowMs) {
      this.good += 1;
      this.bad = 0;
      if (this.good >= this.opts.raiseAfter) {
        this.good = 0;
        this.lastChangeMs = nowMs;
        return 'up';
      }
    } else {
      this.bad = 0;
      this.good = 0;
    }
    return null;
  }
}
