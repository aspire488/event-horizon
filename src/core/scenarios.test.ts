import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { loadScenario, SCENARIOS, resetWorld } from './scenarios';
import { stepWorld } from './physics';

describe('scenarios', () => {
  it('exposes the six documented worlds', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'prime',
      'binary',
      'singularity',
      'collapse',
      'slingshot',
      'chaos',
    ]);
  });

  for (const scenario of SCENARIOS) {
    it(`builds a valid, finite universe for ${scenario.id}`, () => {
      const world = createWorld(1, 12_000);
      loadScenario(world, scenario.id, 2400);
      expect(world.bodies.length).toBeGreaterThan(0);
      expect(world.particles.count).toBeGreaterThan(100);
      expect(world.baseline).toBe(world.particles.count);
      expect(world.params.seed).toBe(scenario.seed);
      for (let i = 0; i < world.particles.count; i++) {
        expect(Number.isFinite(world.particles.x[i])).toBe(true);
        expect(Number.isFinite(world.particles.y[i])).toBe(true);
        expect(Number.isFinite(world.particles.vx[i])).toBe(true);
        expect(Number.isFinite(world.particles.vy[i])).toBe(true);
        expect(world.particles.life[i]).toBeGreaterThan(0);
      }
      for (const body of world.bodies) {
        expect(Number.isFinite(body.x)).toBe(true);
        expect(Number.isFinite(body.mass)).toBe(true);
        expect(body.mass).toBeGreaterThanOrEqual(0);
      }
      // The world remains numerically stable for a second of simulation.
      for (let i = 0; i < 60; i++) stepWorld(world, 1 / 60);
      expect(Number.isFinite(world.particles.x[0])).toBe(true);
    });
  }

  it('is deterministic for a given seed', () => {
    const a = createWorld(1, 12_000);
    const b = createWorld(999, 12_000);
    loadScenario(a, 'chaos', 2000);
    loadScenario(b, 'chaos', 2000);
    expect(a.particles.count).toBe(b.particles.count);
    expect(a.bodies.map((x) => x.mass)).toEqual(b.bodies.map((x) => x.mass));
    for (let i = 0; i < Math.min(200, a.particles.count); i++) {
      expect(a.particles.x[i]).toBeCloseTo(b.particles.x[i], 5);
      expect(a.particles.vx[i]).toBeCloseTo(b.particles.vx[i], 5);
    }
  });

  it('builds distinct initial states', () => {
    const a = createWorld(1, 12_000);
    const b = createWorld(1, 12_000);
    loadScenario(a, 'binary', 1500);
    loadScenario(b, 'singularity', 1500);
    expect(a.bodies.some((body) => body.kind === 'blackhole')).toBe(false);
    expect(b.bodies.some((body) => body.kind === 'blackhole')).toBe(true);
  });

  it('resets a world in place so renderer buffers stay valid', () => {
    const world = createWorld(1, 4000);
    loadScenario(world, 'prime', 1200);
    const particleArray = world.particles.x;
    resetWorld(world, 5);
    expect(world.particles.x).toBe(particleArray);
    expect(world.particles.count).toBe(0);
    expect(world.bodies).toHaveLength(0);
    expect(world.time).toBe(0);
    expect(world.params.seed).toBe(5);
  });

  it('gives a collapse scenario a star that is genuinely unstable', () => {
    const world = createWorld(1, 12_000);
    loadScenario(world, 'collapse', 2000);
    const unstable = world.bodies.find((body) => body.kind === 'star' && body.life > 0);
    expect(unstable).toBeDefined();
    expect(unstable!.life).toBeGreaterThan(0);
  });
});
