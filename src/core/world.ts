import { Rng } from './rng';
import { createParticleField, addParticle } from './particles';
import type {
  Body,
  BodyKind,
  Shockwave,
  SimParams,
  SimStats,
  World,
} from './types';

export const PARTICLE_CAPACITY = 24000;
export const WORLD_BOUND = 9000;
/** Event-horizon radius as a multiple of a black hole's drawn radius. */
export const HORIZON_FACTOR = 2.4;
/** Trail samples retained per body. */
export const BODY_TRAIL_MAX = 220;

export const PALETTE = {
  white: 0,
  amber: 1,
  cyan: 2,
  violet: 3,
  dust: 4,
  hot: 5,
} as const;

export function emptyStats(): SimStats {
  return {
    absorbed: 0,
    absorbedByBlackHole: 0,
    merged: 0,
    supernovas: 0,
    shockedParticles: 0,
    slingshots: 0,
    emitted: 0,
  };
}

export function defaultParams(seed = 1): SimParams {
  return {
    gravity: 3000,
    speed: 1,
    soften: 26,
    trailLength: 0.55,
    seed,
  };
}

export function createWorld(seed = 1, capacity = PARTICLE_CAPACITY): World {
  return {
    bodies: [],
    particles: createParticleField(capacity),
    shockwaves: [],
    params: defaultParams(seed),
    stats: emptyStats(),
    time: 0,
    stepCount: 0,
    nextId: 1,
    rng: new Rng(seed),
    baseline: 0,
  };
}

export function eventHorizon(body: Body): number {
  return body.kind === 'blackhole' ? body.radius * HORIZON_FACTOR : 0;
}

/** Signed force mass used by the particle integrator. */
export function forceMass(body: Body): number {
  if (body.kind === 'repulsor') return -body.strength * 1100;
  if (body.kind === 'well') return body.mass * body.strength;
  if (body.kind === 'blackhole') return body.mass;
  return body.mass;
}

interface BodyDefaults {
  mass: number;
  radius: number;
  influence: number;
  strength: number;
  hue: number;
  label: string;
}

const DEFAULTS: Record<BodyKind, BodyDefaults> = {
  star: { mass: 900, radius: 26, influence: 0, strength: 1, hue: PALETTE.amber, label: 'STAR' },
  planet: { mass: 28, radius: 5.5, influence: 0, strength: 1, hue: PALETTE.cyan, label: 'PLANET' },
  blackhole: { mass: 2800, radius: 15, influence: 0, strength: 1, hue: PALETTE.violet, label: 'SGR' },
  well: { mass: 700, radius: 9, influence: 460, strength: 1, hue: PALETTE.amber, label: 'WELL' },
  repulsor: { mass: 0, radius: 9, influence: 400, strength: 1, hue: PALETTE.cyan, label: 'REPULSOR' },
};

export function makeBody(world: World, kind: BodyKind, x: number, y: number, overrides: Partial<Body> = {}): Body {
  const d = DEFAULTS[kind];
  const id = world.nextId++;
  const body: Body = {
    kind,
    label: overrides.label ?? `${d.label}-${String(id).padStart(2, '0')}`,
    x,
    y,
    vx: 0,
    vy: 0,
    mass: d.mass,
    radius: d.radius,
    influence: d.influence,
    strength: d.strength,
    life: -1,
    maxLife: -1,
    hue: d.hue,
    spin: world.rng.range(0, Math.PI * 2),
    seed: world.rng.range(0, 1),
    trail: [],
    ...overrides,
    id,
  };
  if (body.maxLife < 0 && body.life >= 0) body.maxLife = body.life;
  return body;
}

export function addBody(world: World, kind: BodyKind, x: number, y: number, overrides: Partial<Body> = {}): Body {
  const body = makeBody(world, kind, x, y, overrides);
  world.bodies.push(body);
  return body;
}

export function findBody(world: World, id: number | null): Body | null {
  if (id === null) return null;
  for (const b of world.bodies) if (b.id === id) return b;
  return null;
}

export function removeBody(world: World, id: number): Body | null {
  const index = world.bodies.findIndex((b) => b.id === id);
  if (index < 0) return null;
  return world.bodies.splice(index, 1)[0];
}

export interface ShockwaveSpec {
  x: number;
  y: number;
  radius?: number;
  speed?: number;
  strength?: number;
  width?: number;
  maxRadius?: number;
  life?: number;
  hue?: number;
}

export function addShockwave(world: World, spec: ShockwaveSpec): Shockwave {
  const radius = spec.radius ?? 12;
  const maxRadius = spec.maxRadius ?? 1600;
  const speed = spec.speed ?? 820;
  const wave: Shockwave = {
    id: world.nextId++,
    x: spec.x,
    y: spec.y,
    radius,
    prevRadius: radius,
    speed,
    strength: spec.strength ?? 130,
    width: spec.width ?? 110,
    maxRadius,
    life: spec.life ?? maxRadius / speed,
    maxLife: spec.life ?? maxRadius / speed,
    hue: spec.hue ?? PALETTE.hot,
  };
  world.shockwaves.push(wave);
  return wave;
}

export interface BurstSpec {
  x: number;
  y: number;
  count: number;
  speed: number;
  spread?: number; // radians of directional spread, undefined = full circle
  angle?: number; // center angle for directional bursts
  vx?: number;
  vy?: number;
  size?: number;
  life?: number;
  pal?: number;
  z?: number;
  type?: number;
}

/** Radial or directional particle burst. */
export function emitBurst(world: World, spec: BurstSpec): void {
  const rng = world.rng;
  const spread = spec.spread ?? Math.PI * 2;
  const center = spec.angle ?? 0;
  const full = spread >= Math.PI * 2 - 0.001;
  for (let i = 0; i < spec.count; i++) {
    const a = full ? rng.range(0, Math.PI * 2) : center + rng.range(-spread / 2, spread / 2);
    const speed = spec.speed * (0.35 + rng.next() * 0.85);
    addParticle(world.particles, {
      x: spec.x + rng.normal(1.5),
      y: spec.y + rng.normal(1.5),
      z: spec.z ?? rng.range(-40, 40),
      vx: (spec.vx ?? 0) + Math.cos(a) * speed,
      vy: (spec.vy ?? 0) + Math.sin(a) * speed,
      life: (spec.life ?? 30) * rng.range(0.6, 1.35),
      size: spec.size ?? 2.4,
      pal: spec.pal ?? PALETTE.amber,
      seed: rng.next(),
      type: spec.type ?? 1,
    });
  }
  world.stats.emitted += spec.count;
}

/** Detonates a supernova at a point: shockwave, ejecta, illumination. */
export function detonateAt(
  world: World,
  x: number,
  y: number,
  opts: { power?: number; hue?: number } = {},
): Shockwave {
  const power = opts.power ?? 1;
  const wave = addShockwave(world, {
    x,
    y,
    radius: 16,
    speed: 760 * Math.sqrt(power),
    strength: 150 * power,
    width: 130,
    maxRadius: 1500 * power,
    hue: opts.hue ?? PALETTE.hot,
  });
  emitBurst(world, {
    x,
    y,
    count: Math.round(240 * power),
    speed: 210 * Math.sqrt(power),
    size: 3,
    life: 34,
    pal: opts.hue ?? PALETTE.amber,
    type: 1,
  });
  world.stats.supernovas += 1;
  return wave;
}

/** A star reaching the end of its life collapses and detonates, leaving a remnant core. */
export function collapseStar(world: World, star: Body): void {
  removeBody(world, star.id);
  detonateAt(world, star.x, star.y, { power: Math.min(1.8, 0.65 + star.mass / 2600), hue: PALETTE.amber });
  if (star.mass > 320) {
    addBody(world, 'planet', star.x, star.y, {
      vx: star.vx,
      vy: star.vy,
      mass: star.mass * 0.18,
      radius: Math.max(4, star.radius * 0.28),
      hue: PALETTE.white,
      label: `CORE-${star.id}`,
    });
  }
}

/** Clear transient effects and matter, keeping force sources. */
export function clearTransient(world: World): void {
  world.particles.count = 0;
  world.shockwaves.length = 0;
}

export function worldSnapshotMeta(world: World): string {
  return `${world.bodies.length} bodies · ${world.particles.count} particles · t=${world.time.toFixed(1)}`;
}
