import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, DEFAULT_ADAPTIVE, PerfMonitor, percentileOf, type QualityStep } from './perf';

describe('percentileOf', () => {
  it('computes percentiles against a sorted sample set', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentileOf(samples, 0.5)).toBe(50);
    expect(percentileOf(samples, 0.95)).toBe(95);
    expect(percentileOf(samples, 0.99)).toBe(99);
    expect(percentileOf(samples, 1)).toBe(100);
  });

  it('handles empty and single-element sets without NaN', () => {
    expect(percentileOf([], 0.95)).toBe(0);
    expect(percentileOf([7], 0.5)).toBe(7);
  });

  it('does not mutate the input array', () => {
    const input = [3, 1, 2];
    percentileOf(input, 0.5);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('PerfMonitor', () => {
  it('keeps a bounded ring buffer in chronological order', () => {
    const perf = new PerfMonitor(30);
    for (let i = 1; i <= 40; i++) perf.update(i / 1000); // 1..40 ms frames
    const samples = perf.samples();
    expect(samples).toHaveLength(30);
    // Oldest samples were evicted: first retained sample is 11ms.
    expect(samples[0]).toBeCloseTo(11, 6);
    expect(samples[29]).toBeCloseTo(40, 6);
  });

  it('reports monotonic percentiles and honest worst frame', () => {
    const perf = new PerfMonitor(360);
    for (let i = 0; i < 200; i++) perf.update(1 / 60);
    perf.update(0.12); // one 120ms hitch
    const snap = perf.snapshot();
    expect(snap.p50).toBeLessThanOrEqual(snap.p95);
    expect(snap.p95).toBeLessThanOrEqual(snap.p99);
    expect(snap.p99).toBeLessThanOrEqual(snap.worstMs);
    expect(snap.worstMs).toBeCloseTo(120, 6);
    expect(snap.samples).toBe(201);
  });

  it('smooths the physics/render split and survives bad input', () => {
    const perf = new PerfMonitor();
    perf.recordSections(2, 8);
    // EMA warms up from zero: one valid sample contributes α·value.
    expect(perf.physicsMs).toBeCloseTo(0.2, 6);
    expect(perf.renderMs).toBeCloseTo(0.8, 6);
    perf.recordSections(NaN, -5); // ignored
    expect(perf.physicsMs).toBeCloseTo(0.2, 6);
    perf.recordSections(2, 8);
    expect(perf.physicsMs).toBeGreaterThan(0.2);
    expect(perf.renderMs).toBeGreaterThan(0.8);
    perf.update(0); // ignored
    perf.update(NaN); // ignored
    expect(perf.samples()).toHaveLength(0);
  });

  it('resetSamples clears everything', () => {
    const perf = new PerfMonitor();
    perf.update(1 / 30);
    perf.recordSections(3, 10);
    perf.resetSamples();
    const snap = perf.snapshot();
    expect(snap.samples).toBe(0);
    expect(snap.fps).toBe(0);
    expect(snap.worstMs).toBe(0);
    expect(snap.physicsMs).toBe(0);
  });
});

describe('AdaptiveQuality', () => {
  const opts = { windowFrames: 4, dropAboveMs: 20, raiseBelowMs: 13, dropAfter: 2, raiseAfter: 3, cooldownMs: 1000 };

  function run(controller: AdaptiveQuality, frames: number[], startMs: number): QualityStep[] {
    const steps: QualityStep[] = [];
    let now = startMs;
    for (const ms of frames) {
      const step = controller.nextFrame(ms, now);
      if (step) steps.push(step);
      now += 16;
    }
    return steps;
  }

  it('drops only after consecutive over-budget windows', () => {
    const c = new AdaptiveQuality(opts);
    // 3 slow windows (25ms p95) — dropAfter=2 → exactly one 'down'.
    const steps = run(c, new Array(12).fill(25), 0);
    expect(steps).toEqual(['down']);
  });

  it('raises only after consecutive fast windows and respects the ladder pace', () => {
    const c = new AdaptiveQuality(opts);
    // 5 fast windows → raiseAfter=3 → one 'up' (second would be cooldown-blocked).
    const steps = run(c, new Array(20).fill(8), 0);
    expect(steps).toEqual(['up']);
  });

  it('never flips on mixed or borderline windows (hysteresis band)', () => {
    const c = new AdaptiveQuality(opts);
    // Interleaved window-sized blocks: one bad window, then one fast window.
    // Streak counters keep resetting, so neither threshold can be reached.
    const frames: number[] = [];
    for (let block = 0; block < 8; block++) {
      for (let i = 0; i < 4; i++) frames.push(block % 2 === 0 ? 25 : 8);
    }
    expect(run(c, frames, 0)).toHaveLength(0);
    // A steady 18ms stream sits inside the dead band (13 < 18 ≤ 20): no action.
    const steady = new AdaptiveQuality(opts);
    expect(run(steady, new Array(40).fill(18), 0)).toHaveLength(0);
  });

  it('suppresses changes during the cooldown window', () => {
    const c = new AdaptiveQuality({ ...opts, cooldownMs: 10_000 });
    const first = run(c, new Array(8).fill(25), 0);
    expect(first).toEqual(['down']);
    // More slow windows inside the cooldown: no further steps.
    const second = run(c, new Array(24).fill(25), 100);
    expect(second).toHaveLength(0);
  });

  it('ignores invalid frame times and reset() clears streaks', () => {
    const c = new AdaptiveQuality(opts);
    expect(c.nextFrame(Number.NaN, 0)).toBeNull();
    expect(c.nextFrame(-1, 0)).toBeNull();
    run(c, new Array(4).fill(25), 0); // one bad window (bad=1)
    c.reset();
    // After reset the streak restarts: one more bad window alone must not drop.
    const steps = run(c, new Array(4).fill(25), 0);
    expect(steps).toHaveLength(0);
  });

  it('uses production defaults when no options are given', () => {
    const c = new AdaptiveQuality();
    const frames = new Array(DEFAULT_ADAPTIVE.windowFrames * DEFAULT_ADAPTIVE.dropAfter + 2).fill(50);
    const steps = run(c, frames, 0);
    expect(steps).toEqual(['down']);
  });
});
