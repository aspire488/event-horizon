import { describe, expect, it } from 'vitest';
import { ObjectiveTracker } from './objectives';
import { addBody, createWorld, PALETTE } from './world';
import { addParticle } from './particles';
import { circularOrbitSpeed, stepWorld } from './physics';

describe('ObjectiveTracker', () => {
  it('completes stat-driven objectives exactly once', () => {
    const tracker = new ObjectiveTracker();
    const world = createWorld(7);
    world.stats.absorbedByBlackHole = 25;
    world.stats.merged = 1;
    world.stats.shockedParticles = 150;
    world.stats.slingshots = 1;
    const first = tracker.evaluate(world, 0.1);
    expect(first.map((o) => o.id).sort()).toEqual(['capture', 'collision', 'shockwave', 'slingshot']);
    const second = tracker.evaluate(world, 0.1);
    expect(second).toHaveLength(0);
    expect(tracker.objectives.find((o) => o.id === 'capture')?.progress).toBe(1);
  });

  it('detects a real full orbit of a particle around a star', () => {
    const tracker = new ObjectiveTracker();
    const world = createWorld(99, 512);
    const star = addBody(world, 'star', 0, 0, { mass: 2000, radius: 26 });
    const radius = 420;
    addParticle(world.particles, {
      x: radius,
      y: 0,
      vx: 0,
      vy: circularOrbitSpeed(star.mass, radius, world.params.gravity),
      life: 900,
      size: 2,
      pal: PALETTE.white,
    });
    let done = false;
    for (let i = 0; i < 60 * 32; i++) {
      stepWorld(world, 1 / 60);
      const completed = tracker.evaluate(world, 1 / 60);
      if (completed.some((o) => o.id === 'orbit')) done = true;
    }
    expect(done).toBe(true);
    expect(tracker.objectives.find((o) => o.id === 'orbit')?.done).toBe(true);
  });

  it('resets progress and orbit tracking', () => {
    const tracker = new ObjectiveTracker();
    const world = createWorld(3);
    world.stats.merged = 1;
    tracker.evaluate(world, 0.1);
    expect(tracker.objectives.find((o) => o.id === 'collision')?.done).toBe(true);
    tracker.reset();
    expect(tracker.objectives.every((o) => !o.done && o.progress === 0)).toBe(true);
  });
});
