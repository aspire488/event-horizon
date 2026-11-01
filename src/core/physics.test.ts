import { describe, expect, it, vi } from 'vitest';
import {
  circularOrbitSpeed,
  gravityAcceleration,
  MAX_ACCEL,
  stepWorld,
} from './physics';
import { addBody, addShockwave, createWorld, eventHorizon, PALETTE } from './world';
import { addParticle } from './particles';
import { loadScenario } from './scenarios';
import type { World } from './types';

function world(capacity = 400): World {
  return createWorld(12345, capacity);
}

describe('gravitational force', () => {
  it('points toward the mass and follows the inverse-square law', () => {
    const a = gravityAcceleration(1000, 1000, 0, 0);
    expect(a.ax).toBeCloseTo(3, 6);
    expect(Math.abs(a.ay)).toBeLessThan(1e-9);
    const b = gravityAcceleration(1000, 2000, 0, 0);
    expect(a.ax / b.ax).toBeCloseTo(4, 5);
  });

  it('softens singular forces near r = 0', () => {
    const hard = gravityAcceleration(1000, 5, 0, 0);
    const soft = gravityAcceleration(1000, 5, 0, 26);
    expect(soft.ax).toBeLessThan(hard.ax);
    expect(Number.isFinite(soft.ax)).toBe(true);
  });

  it('produces circular-orbit speeds consistent with the force', () => {
    const mass = 2000;
    const radius = 500;
    const speed = circularOrbitSpeed(mass, radius);
    const centripetal = (speed * speed) / radius;
    const gravity = gravityAcceleration(mass, radius, 0, 0).ax;
    expect(centripetal).toBeCloseTo(gravity, 6);
  });
});

describe('stable integration', () => {
  it('keeps a circular orbit bounded over a full revolution', () => {
    const w = world();
    const star = addBody(w, 'star', 0, 0, { mass: 2000, vx: 0, vy: 0 });
    const radius = 550;
    const speed = circularOrbitSpeed(star.mass, radius, w.params.gravity);
    addParticle(w.particles, {
      x: radius,
      y: 0,
      vx: 0,
      vy: speed,
      life: 900,
      size: 2,
      pal: PALETTE.white,
    });
    let minRadius = Infinity;
    let maxRadius = 0;
    for (let i = 0; i < 60 * 25; i++) {
      stepWorld(w, 1 / 60);
      const r = Math.hypot(w.particles.x[0], w.particles.y[0]);
      minRadius = Math.min(minRadius, r);
      maxRadius = Math.max(maxRadius, r);
    }
    expect(w.particles.count).toBe(1);
    expect(Number.isFinite(w.particles.x[0])).toBe(true);
    expect(minRadius).toBeGreaterThan(radius * 0.75);
    expect(maxRadius).toBeLessThan(radius * 1.25);
  });

  it('stays finite for a particle at the exact singularity', () => {
    const w = world();
    addBody(w, 'star', 0, 0, { mass: 4000 });
    addParticle(w.particles, { x: 0, y: 0, vx: 0, vy: 0, life: 10, size: 2, pal: PALETTE.white });
    for (let i = 0; i < 20; i++) stepWorld(w, 1 / 60);
    expect(Number.isFinite(w.particles.x[0])).toBe(true);
    expect(Number.isFinite(w.particles.vx[0])).toBe(true);
  });

  it('caps extreme accelerations instead of exploding', () => {
    const w = world();
    addBody(w, 'blackhole', 0, 0, { mass: 8000, radius: 20 });
    addParticle(w.particles, { x: 45, y: 0, vx: 0, vy: 0, life: 10, size: 2, pal: PALETTE.white });
    stepWorld(w, 1 / 60);
    if (w.particles.count > 0) {
      expect(Math.abs(w.particles.vx[0])).toBeLessThanOrEqual(MAX_ACCEL * (1 / 60) + 1);
    }
  });
});

describe('absorption and merging', () => {
  it('consumes particles that cross the event horizon', () => {
    const w = world();
    const hole = addBody(w, 'blackhole', 0, 0, { mass: 3000, radius: 12 });
    addParticle(w.particles, { x: 0, y: 0, vx: 0, vy: 0, life: 50, size: 2, pal: PALETTE.white });
    const before = hole.mass;
    stepWorld(w, 1 / 60);
    expect(w.particles.count).toBe(0);
    expect(w.stats.absorbed).toBe(1);
    expect(w.stats.absorbedByBlackHole).toBe(1);
    expect(hole.mass).toBeGreaterThan(before);
    expect(eventHorizon(hole)).toBeGreaterThan(0);
  });

  it('merges overlapping bodies conserving mass and momentum', () => {
    const w = world();
    const a = addBody(w, 'star', 0, 0, { mass: 1200, radius: 25, vx: 40, vy: 0 });
    const b = addBody(w, 'star', 6, 0, { mass: 800, radius: 20, vx: -40, vy: 0 });
    const px = a.mass * a.vx + b.mass * b.vx;
    const py = a.mass * a.vy + b.mass * b.vy;
    const hooks = { onMerge: vi.fn() };
    stepWorld(w, 1 / 60, hooks);
    expect(w.bodies).toHaveLength(1);
    expect(hooks.onMerge).toHaveBeenCalledTimes(1);
    expect(w.stats.merged).toBe(1);
    const survivor = w.bodies[0];
    expect(survivor.mass).toBeCloseTo(2000, 5);
    // Momentum is conserved to within the body-body impulse during the merge step.
    expect(survivor.mass * survivor.vx).toBeCloseTo(px, 0);
    expect(survivor.mass * survivor.vy).toBeCloseTo(py, 5);
  });

  it('lets a black hole swallow a star', () => {
    const w = world();
    const hole = addBody(w, 'blackhole', 0, 0, { mass: 3000, radius: 15 });
    addBody(w, 'star', 10, 0, { mass: 900, radius: 20 });
    stepWorld(w, 1 / 60);
    expect(w.bodies).toHaveLength(1);
    expect(w.bodies[0].id).toBe(hole.id);
    expect(w.bodies[0].mass).toBeGreaterThan(3000);
  });
});

describe('shockwaves', () => {
  it('accelerates matter outward as the front crosses it', () => {
    const w = world();
    const initialRadius = 10;
    addShockwave(w, {
      x: 0,
      y: 0,
      radius: initialRadius,
      speed: 600,
      strength: 400,
      width: 120,
      maxRadius: 2000,
    });
    addParticle(w.particles, { x: 120, y: 0, vx: 0, vy: 0, life: 20, size: 2, pal: PALETTE.white });
    for (let i = 0; i < 10; i++) stepWorld(w, 1 / 60);
    expect(w.particles.vx[0]).toBeGreaterThan(0);
    expect(Math.abs(w.particles.vy[0])).toBeLessThan(1e-3);
    expect(w.stats.shockedParticles).toBeGreaterThan(0);
    expect(w.shockwaves[0].radius).toBeGreaterThan(initialRadius);
  });

  it('expires when it reaches its maximum radius', () => {
    const w = world();
    addShockwave(w, { x: 0, y: 0, radius: 10, speed: 1000, strength: 100, width: 40, maxRadius: 100 });
    for (let i = 0; i < 30; i++) stepWorld(w, 1 / 60);
    expect(w.shockwaves).toHaveLength(0);
  });
});

describe('stellar collapse', () => {
  it('detonates a star at the end of its life', () => {
    const w = world();
    addBody(w, 'star', 0, 0, { mass: 1500, radius: 30, life: 0.02, maxLife: 0.02 });
    const onSupernova = vi.fn();
    for (let i = 0; i < 4; i++) stepWorld(w, 1 / 60, { onSupernova });
    expect(onSupernova).toHaveBeenCalledTimes(1);
    expect(w.stats.supernovas).toBe(1);
    expect(w.shockwaves.length).toBeGreaterThan(0);
    expect(w.particles.count).toBeGreaterThan(100);
    expect(w.bodies.some((b) => b.kind === 'star')).toBe(false);
  });
});

describe('slingshot detection', () => {
  it('counts a genuine inbound-to-outbound flyby exactly once', () => {
    const w = world();
    addBody(w, 'star', 0, 0, { mass: 2000, radius: 26 });
    // Fast hyperbolic flyby: inbound at (−800, 150), swings past, exits outbound.
    addParticle(w.particles, {
      x: -800,
      y: 150,
      vx: 380,
      vy: 0,
      life: 30,
      size: 2,
      pal: PALETTE.white,
    });
    const onSlingshot = vi.fn();
    for (let i = 0; i < 300; i++) stepWorld(w, 1 / 60, { onSlingshot });
    expect(w.stats.slingshots).toBe(1);
    expect(onSlingshot).toHaveBeenCalledTimes(1);
  });

  it('never counts a stable circular orbiter (two-phase guard)', () => {
    const w = world();
    addBody(w, 'star', 0, 0, { mass: 2000, radius: 26 });
    // Tight, fast orbit: speed 131 u/s clears the >120 arm gate, so only the
    // radial-velocity guard prevents a false positive here.
    const radius = 350;
    const speed = circularOrbitSpeed(2000, radius, w.params.gravity);
    expect(speed).toBeGreaterThan(120);
    addParticle(w.particles, {
      x: radius,
      y: 0,
      vx: 0,
      vy: speed,
      life: 60,
      size: 2,
      pal: PALETTE.white,
    });
    for (let i = 0; i < 1080; i++) stepWorld(w, 1 / 60); // ≈ one full revolution
    expect(w.stats.slingshots).toBe(0);
    // The orbit itself must still be healthy after the run.
    const r = Math.hypot(w.particles.x[0], w.particles.y[0]);
    expect(r).toBeGreaterThan(radius * 0.75);
    expect(r).toBeLessThan(radius * 1.25);
  });

  it('does not fire early on the Prime Field scenario', () => {
    // Regression: the previous single-phase detector reported a slingshot at
    // T+0.9s on load, when disc particles merely swept inward.
    const w = createWorld(12345, 6000);
    loadScenario(w, 'prime', 2500);
    for (let i = 0; i < 360; i++) stepWorld(w, 1 / 60); // six simulated seconds
    expect(w.stats.slingshots).toBe(0);
  });
});

describe('conservation (regression)', () => {
  const momentum = (w: World) =>
    w.bodies.reduce((p, b) => [p[0] + b.mass * b.vx, p[1] + b.mass * b.vy], [0, 0]);

  it('places a merged body at the centre of mass', () => {
    const w = world();
    addBody(w, 'star', 0, 0, { mass: 1000, radius: 25 });
    addBody(w, 'star', 30, 0, { mass: 1000, radius: 25 });
    stepWorld(w, 1 / 60);
    expect(w.bodies).toHaveLength(1);
    // Was 25.27 when the survivor slid only 15% toward its partner.
    expect(w.bodies[0].x).toBeCloseTo(15, 1);
  });

  it('keeps a massless repulsor pair finite when they touch', () => {
    const w = world();
    addBody(w, 'repulsor', 0, 0, { mass: 0 });
    addBody(w, 'repulsor', 2, 0, { mass: 0 });
    stepWorld(w, 1 / 60);
    expect(w.bodies).toHaveLength(1);
    const b = w.bodies[0];
    expect([b.x, b.y, b.vx, b.vy].every(Number.isFinite)).toBe(true);
  });

  it('conserves momentum when a moving black hole accretes resting matter', () => {
    const w = world(2000);
    const hole = addBody(w, 'blackhole', 0, 0, { mass: 3000, radius: 15, vx: 100 });
    for (let i = 0; i < 400; i++) {
      addParticle(w.particles, {
        x: (i % 20) - 10, y: Math.floor(i / 20) - 10, z: 0, vx: 0, vy: 0,
        life: 30, size: 2, pal: 0, seed: 0, type: 0,
      });
    }
    stepWorld(w, 1 / 60);
    expect(hole.mass).toBeCloseTo(4000, 5);
    // Was 400,000: mass arrived with no momentum and the hole kept its speed.
    expect(hole.mass * hole.vx).toBeCloseTo(300_000, 0);
  });

  it('conserves total body momentum through a chaotic run with mergers', () => {
    const w = createWorld(5, 4000);
    loadScenario(w, 'chaos', 0);
    // Isolate the body system: accreted matter legitimately brings its own
    // momentum in, so remove every particle.
    w.particles.count = 0;
    const p0 = momentum(w);
    let merges = 0;
    for (let i = 0; i < 3600; i++) stepWorld(w, 1 / 60, { onMerge: () => merges++ });
    const p1 = momentum(w);
    expect(merges).toBeGreaterThan(0);
    expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])).toBeLessThan(1e-6 * Math.max(1, Math.hypot(p0[0], p0[1])) + 1e-3);
  });

  it('stays deterministic: identical seeds give identical universes', () => {
    const run = () => {
      const w = createWorld(9, 4000);
      loadScenario(w, 'chaos', 1500);
      for (let i = 0; i < 600; i++) stepWorld(w, 1 / 60);
      return `${w.particles.count}|${w.bodies.map((b) => `${b.x},${b.y},${b.mass}`).join(';')}`;
    };
    expect(run()).toBe(run());
  });
});
