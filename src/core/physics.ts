import { removeParticle } from './particles';
import { collapseStar, forceMass, HORIZON_FACTOR, WORLD_BOUND } from './world';
import type { Body, World } from './types';

export const MAX_ACCEL = 1500;
export const MAX_SPEED = 900;

export interface StepHooks {
  onMerge?: (survivor: Body, consumed: Body) => void;
  onBlackHoleAbsorb?: (hole: Body, count: number) => void;
  onSupernova?: (star: Body) => void;
  onSlingshot?: (x: number, y: number, speed: number) => void;
}

/** Newtonian acceleration from a point mass with Plummer softening. */
export function gravityAcceleration(
  mass: number,
  dx: number,
  dy: number,
  softening: number,
  gravity = 3000,
): { ax: number; ay: number } {
  const soft2 = softening * softening;
  const d2 = dx * dx + dy * dy + soft2;
  const inv = 1 / Math.sqrt(d2);
  const inv3 = inv * inv * inv;
  const k = mass * gravity * inv3;
  return { ax: dx * k, ay: dy * k };
}

/** Speed of a circular orbit at radius r around a body of the given mass. */
export function circularOrbitSpeed(centralMass: number, radius: number, gravity = 3000): number {
  if (radius <= 0) return 0;
  return Math.sqrt((gravity * centralMass) / radius);
}

/** Ray-circle overlap test used for selection. */
export function bodyAtPoint(bodies: Body[], x: number, y: number, tolerance = 14): Body | null {
  let best: Body | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    const dx = b.x - x;
    const dy = b.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const radius = Math.max(b.radius + tolerance, b.kind === 'planet' ? 26 : b.radius + tolerance);
    if (d <= radius && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** Advances the whole universe by one fixed timestep. */
export function stepWorld(world: World, dt: number, hooks: StepHooks = {}): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const h = Math.min(dt, 1 / 30);
  world.time += h;
  world.stepCount += 1;

  const bodies = world.bodies;
  const G = world.params.gravity;

  // --- Body-body gravity (few bodies, direct summation is exact enough) ---
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 900;
      const inv = 1 / Math.sqrt(d2);
      const inv3 = inv * inv * inv;
      const k = G * inv3;
      a.vx += dx * k * b.mass * h;
      a.vy += dy * k * b.mass * h;
      b.vx -= dx * k * a.mass * h;
      b.vy -= dy * k * a.mass * h;
    }
  }

  // --- Integrate bodies, aging stars ---
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.spin += h * (b.kind === 'blackhole' ? 1.7 : 0.4);
    if (world.stepCount % 4 === 0) {
      b.trail.push(b.x, b.y);
      if (b.trail.length > 440) b.trail.splice(0, 2);
    }
    if (b.life > 0) {
      b.life -= h;
      if (b.life <= 0) {
        collapseStar(world, b);
        hooks.onSupernova?.(b);
      }
    }
  }

  // --- Collisions / capture ---
  for (let i = bodies.length - 1; i >= 0; i--) {
    const a = bodies[i];
    if (!a) continue;
    for (let j = i - 1; j >= 0; j--) {
      const b = bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const horizonA = a.kind === 'blackhole' ? a.radius * HORIZON_FACTOR : 0;
      const horizonB = b.kind === 'blackhole' ? b.radius * HORIZON_FACTOR : 0;
      const capture = d < Math.max(horizonA + b.radius * 0.35, horizonB + a.radius * 0.35);
      const contact = d < (a.radius + b.radius) * 0.72;

      if (!capture && !contact) continue;

      // Survivor is the heavier body; a black hole always wins.
      const aSurvives = a.kind === 'blackhole' || (b.kind !== 'blackhole' && a.mass >= b.mass);
      const survivor: Body = aSurvives ? a : b;
      const consumed: Body = aSurvives ? b : a;
      const consumedIndex = aSurvives ? j : i;

      const totalMass = survivor.mass + consumed.mass;
      survivor.vx = (survivor.vx * survivor.mass + consumed.vx * consumed.mass) / totalMass;
      survivor.vy = (survivor.vy * survivor.mass + consumed.vy * consumed.mass) / totalMass;
      survivor.mass = totalMass;
      if (survivor.kind !== 'blackhole') {
        survivor.radius = Math.cbrt(
          survivor.radius ** 3 + consumed.radius ** 3,
        );
      } else {
        survivor.radius = Math.min(52, survivor.radius + consumed.radius * 0.06);
      }
      survivor.x += (consumed.x - survivor.x) * 0.15;
      survivor.y += (consumed.y - survivor.y) * 0.15;

      bodies.splice(consumedIndex, 1);
      world.stats.merged += 1;
      hooks.onMerge?.(survivor, consumed);
      // Indices shifted; resume the sweep on the next step.
      break;
    }
  }

  // --- Shockwave fronts ---
  for (let i = world.shockwaves.length - 1; i >= 0; i--) {
    const w = world.shockwaves[i];
    w.prevRadius = w.radius;
    w.radius += w.speed * h;
    w.life -= h;
    if (w.radius >= w.maxRadius || w.life <= 0) world.shockwaves.splice(i, 1);
  }

  // --- Matter ---
  const field = world.particles;
  const soft2 = world.params.soften * world.params.soften;
  const waves = world.shockwaves;
  let absorbedByHole = 0;
  let absorbHole: Body | null = null;

  for (let i = field.count - 1; i >= 0; i--) {
    let x = field.x[i];
    let y = field.y[i];
    let vx = field.vx[i];
    let vy = field.vy[i];
    let ax = 0;
    let ay = 0;
    let absorbed = false;
    let viscous = 0;

    for (let bi = 0; bi < bodies.length; bi++) {
      const body = bodies[bi];
      const m = forceMass(body);
      if (m === 0) continue;
      const dx = body.x - x;
      const dy = body.y - y;
      const d2raw = dx * dx + dy * dy;

      if (body.kind === 'blackhole') {
        const horizon = body.radius * HORIZON_FACTOR;
        if (d2raw < horizon * horizon) {
          absorbed = true;
          absorbHole = body;
          break;
        }
        // Accretion drag: matter close to the horizon loses orbital energy and
        // spirals in instead of orbiting forever just outside the horizon.
        const accretionRadius = horizon * 3.6;
        const distance = Math.sqrt(d2raw);
        if (distance < accretionRadius) {
          const f = 1 - distance / accretionRadius;
          viscous = Math.max(viscous, f * f * 2.8);
        }
      }

      let window = 1;
      if (body.influence > 0) {
        if (d2raw > body.influence * body.influence) continue;
        const r = Math.sqrt(d2raw);
        const inner = body.influence * 0.72;
        if (r > inner) {
          const t = Math.min(1, (r - inner) / (body.influence - inner));
          window = 1 - t * t * (3 - 2 * t);
        }
      }

      const d2 = d2raw + soft2;
      const inv = 1 / Math.sqrt(d2);
      const inv3 = inv * inv * inv;
      const k = m * G * inv3 * window;
      ax += dx * k;
      ay += dy * k;
    }

    if (absorbed) {
      removeParticle(field, i);
      world.stats.absorbed += 1;
      world.stats.absorbedByBlackHole += 1;
      absorbedByHole += 1;
      if (absorbHole && absorbHole.mass < 26000) absorbHole.mass += 2.5;
      continue;
    }

    // Shockwave impulses (one impulse per particle per front).
    for (let wi = 0; wi < waves.length; wi++) {
      const w = waves[wi];
      const dx = x - w.x;
      const dy = y - w.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const offset = Math.abs(d - w.radius);
      if (offset >= w.width) continue;
      const strength = 1 - offset / w.width;
      const inv = 1 / d;
      ax += dx * inv * w.strength * strength;
      ay += dy * inv * w.strength * strength;
      if (field.shockTag[i] !== w.id) {
        field.shockTag[i] = w.id;
        world.stats.shockedParticles += 1;
      }
    }

    const aMag = Math.hypot(ax, ay);
    if (aMag > MAX_ACCEL) {
      const s = MAX_ACCEL / aMag;
      ax *= s;
      ay *= s;
    }

    // Semi-implicit Euler with optional accretion drag.
    vx += ax * h;
    vy += ay * h;
    if (viscous > 0) {
      const keep = Math.max(0, 1 - viscous * h);
      vx *= keep;
      vy *= keep;
    }
    const speed2 = vx * vx + vy * vy;
    if (speed2 > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Math.sqrt(speed2);
      vx *= s;
      vy *= s;
    }
    x += vx * h;
    y += vy * h;

    field.x[i] = x;
    field.y[i] = y;
    field.vx[i] = vx;
    field.vy[i] = vy;

    // Slingshot detection: a fast outward trajectory in the neighbourhood of a
    // massive body that has not been counted before.
    if (!(field.flags[i] & 1) && speed2 > 170 * 170) {
      for (let bi = 0; bi < bodies.length; bi++) {
        const body = bodies[bi];
        if (body.mass < 400) continue;
        const dx = x - body.x;
        const dy = y - body.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 180 && d < 900 && dx * vx + dy * vy > 0) {
          field.flags[i] |= 1;
          world.stats.slingshots += 1;
          hooks.onSlingshot?.(x, y, Math.sqrt(speed2));
          break;
        }
      }
    }

    field.life[i] -= h;
    if (
      field.life[i] <= 0 ||
      x > WORLD_BOUND ||
      x < -WORLD_BOUND ||
      y > WORLD_BOUND ||
      y < -WORLD_BOUND
    ) {
      removeParticle(field, i);
    }
  }

  if (absorbedByHole > 0 && absorbHole) {
    hooks.onBlackHoleAbsorb?.(absorbHole, absorbedByHole);
  }
}
