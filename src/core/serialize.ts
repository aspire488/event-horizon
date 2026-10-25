import { Rng } from './rng';
import { emptyStats, PARTICLE_CAPACITY } from './world';
import type { Body, BodyKind, Shockwave, SimParams, SimStats, World } from './types';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'god-mode';
export const MAX_IMPORT_BYTES = 6_000_000;
export const MAX_SAVED_PARTICLES = 18_000;
const PARTICLE_STRIDE = 12;

export interface SerializedWorld {
  seed: number;
  time: number;
  stepCount: number;
  nextId: number;
  baseline: number;
  params: SimParams;
  stats: SimStats;
  bodies: Body[];
  shockwaves: Shockwave[];
  particles: { count: number; data: string };
}

export interface ExperimentDoc {
  app: typeof APP_ID;
  schema: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  world: SerializedWorld;
}

function encodeFloats(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeFloats(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteOffset % 4 !== 0) return new Float32Array(bytes.slice().buffer);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
}

export function serializeWorld(world: World): SerializedWorld {
  const count = Math.min(world.particles.count, MAX_SAVED_PARTICLES);
  const stride = PARTICLE_STRIDE;
  const data = new Float32Array(count * stride);
  const f = world.particles;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    data[o] = f.x[i];
    data[o + 1] = f.y[i];
    data[o + 2] = f.z[i];
    data[o + 3] = f.vx[i];
    data[o + 4] = f.vy[i];
    data[o + 5] = f.life[i];
    data[o + 6] = f.maxLife[i];
    data[o + 7] = f.size[i];
    data[o + 8] = f.pal[i];
    data[o + 9] = f.seed[i];
    data[o + 10] = f.type[i];
    data[o + 11] = f.flags[i];
  }
  return {
    seed: world.params.seed,
    time: world.time,
    stepCount: world.stepCount,
    nextId: world.nextId,
    baseline: world.baseline,
    params: { ...world.params },
    stats: { ...world.stats },
    bodies: world.bodies.map((b) => ({ ...b, trail: b.trail.slice(-440) })),
    shockwaves: world.shockwaves.map((s) => ({ ...s })),
    particles: { count, data: encodeFloats(data) },
  };
}

export function serializeExperiment(world: World, name: string, createdAt = Date.now()): ExperimentDoc {
  return {
    app: APP_ID,
    schema: SCHEMA_VERSION,
    name,
    createdAt,
    updatedAt: Date.now(),
    world: serializeWorld(world),
  };
}

export function experimentToJSON(doc: ExperimentDoc): string {
  return JSON.stringify(doc, null, 2);
}

const KINDS: BodyKind[] = ['star', 'planet', 'blackhole', 'well', 'repulsor'];

function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeBody(raw: unknown, index: number): Body {
  const b = (raw ?? {}) as Record<string, unknown>;
  const kind = KINDS.includes(b.kind as BodyKind) ? (b.kind as BodyKind) : 'planet';
  const id = Math.max(1, Math.floor(num(b.id, index + 1, 1, 1_000_000)));
  const life = num(b.life, -1, -1, 1_000_000);
  const trailRaw = Array.isArray(b.trail) ? b.trail : [];
  const trail: number[] = [];
  for (const value of trailRaw.slice(-440)) {
    if (typeof value === 'number' && Number.isFinite(value)) trail.push(Math.max(-50_000, Math.min(50_000, value)));
  }
  return {
    id,
    kind,
    label: typeof b.label === 'string' ? b.label.slice(0, 24) : kind.toUpperCase(),
    x: num(b.x, 0, -50_000, 50_000),
    y: num(b.y, 0, -50_000, 50_000),
    vx: num(b.vx, 0, -5000, 5000),
    vy: num(b.vy, 0, -5000, 5000),
    mass: num(b.mass, 20, 0, 200_000),
    radius: num(b.radius, 6, 0.5, 2000),
    influence: num(b.influence, 0, 0, 8000),
    strength: num(b.strength, 1, -20, 20),
    life,
    maxLife: num(b.maxLife, life, -1, 1_000_000),
    hue: num(b.hue, 0, 0, 5),
    spin: num(b.spin, 0, -1000, 1000),
    seed: num(b.seed, 0.5, 0, 1),
    trail,
  };
}

function sanitizeShockwave(raw: unknown, index: number): Shockwave {
  const s = (raw ?? {}) as Record<string, unknown>;
  const radius = num(s.radius, 12, 0, 20_000);
  const speed = num(s.speed, 600, 1, 20_000);
  const maxRadius = num(s.maxRadius, 1200, radius + 1, 30_000);
  return {
    id: Math.max(1, Math.floor(num(s.id, index + 1, 1, 1_000_000))),
    x: num(s.x, 0, -50_000, 50_000),
    y: num(s.y, 0, -50_000, 50_000),
    radius,
    prevRadius: num(s.prevRadius, radius, 0, 20_000),
    speed,
    strength: num(s.strength, 100, 0, 5000),
    width: num(s.width, 100, 1, 5000),
    maxRadius,
    life: num(s.life, 2, 0, 120),
    maxLife: num(s.maxLife, 2, 0.0001, 120),
    hue: num(s.hue, 5, 0, 5),
  };
}

/**
 * Parses and validates an exported experiment. Throws an Error with a
 * human-readable message for anything that is not a trustworthy GOD MODE file.
 */
export function parseExperiment(text: string): ExperimentDoc {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('The file is empty.');
  if (text.length > MAX_IMPORT_BYTES) throw new Error('File is too large (limit 6 MB).');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('Unrecognised experiment file.');
  const doc = raw as Record<string, unknown>;
  if (doc.app !== APP_ID) throw new Error('This is not a GOD MODE experiment.');
  if (doc.schema !== SCHEMA_VERSION) throw new Error(`Unsupported schema version: ${String(doc.schema)}.`);
  const w = doc.world;
  if (typeof w !== 'object' || w === null) throw new Error('Experiment is missing its universe data.');
  const worldRaw = w as Record<string, unknown>;
  const particlesRaw = (worldRaw.particles ?? {}) as Record<string, unknown>;
  const count = Math.floor(num(particlesRaw.count, 0, 0, MAX_SAVED_PARTICLES));
  if (typeof particlesRaw.data !== 'string') throw new Error('Particle data is missing.');
  let floats: Float32Array;
  try {
    floats = decodeFloats(particlesRaw.data);
  } catch {
    throw new Error('Particle data is corrupted.');
  }
  if (floats.length < count * PARTICLE_STRIDE) throw new Error('Particle data is truncated.');
  for (let i = 0; i < count * PARTICLE_STRIDE; i++) {
    if (!Number.isFinite(floats[i])) throw new Error('Particle data contains invalid values.');
  }

  const bodiesRaw = Array.isArray(worldRaw.bodies) ? worldRaw.bodies.slice(0, 120) : [];
  const wavesRaw = Array.isArray(worldRaw.shockwaves) ? worldRaw.shockwaves.slice(0, 60) : [];
  const paramsRaw = (worldRaw.params ?? {}) as Record<string, unknown>;
  const seed = Math.floor(num(paramsRaw.seed, 1, 0, 4_294_967_295));

  const world: SerializedWorld = {
    seed,
    time: num(worldRaw.time, 0, 0, 1e9),
    stepCount: Math.floor(num(worldRaw.stepCount, 0, 0, 1e12)),
    nextId: Math.floor(num(worldRaw.nextId, 1, 1, 1_000_000)),
    baseline: Math.floor(num(worldRaw.baseline, count, 0, MAX_SAVED_PARTICLES)),
    params: {
      gravity: num(paramsRaw.gravity, 3000, 0, 20_000),
      speed: num(paramsRaw.speed, 1, 0.05, 8),
      soften: num(paramsRaw.soften, 26, 1, 500),
      trailLength: num(paramsRaw.trailLength, 0.55, 0, 1),
      seed,
    },
    stats: emptyStats(),
    bodies: bodiesRaw.map(sanitizeBody),
    shockwaves: wavesRaw.map(sanitizeShockwave),
    particles: { count, data: particlesRaw.data },
  };

  const statsRaw = (worldRaw.stats ?? {}) as Record<string, unknown>;
  const stats = emptyStats();
  for (const key of Object.keys(stats) as (keyof SimStats)[]) {
    stats[key] = Math.floor(num(statsRaw[key], 0, 0, 1e9));
  }
  world.stats = stats;

  return {
    app: APP_ID,
    schema: SCHEMA_VERSION,
    name: typeof doc.name === 'string' ? doc.name.slice(0, 64) : 'Imported experiment',
    createdAt: num(doc.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: num(doc.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    world,
  };
}

/** Replaces the contents of `world` with a validated experiment. */
export function applyExperiment(world: World, doc: ExperimentDoc): void {
  const w = doc.world;
  const floats = decodeFloats(w.particles.data);
  const field = world.particles;
  const count = Math.min(w.particles.count, field.capacity);
  const stride = PARTICLE_STRIDE;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    field.x[i] = floats[o];
    field.y[i] = floats[o + 1];
    field.z[i] = floats[o + 2];
    field.vx[i] = floats[o + 3];
    field.vy[i] = floats[o + 4];
    field.life[i] = floats[o + 5];
    field.maxLife[i] = Math.max(floats[o + 6], 0.001);
    field.size[i] = Math.max(floats[o + 7], 0.4);
    field.pal[i] = Math.min(5, Math.max(0, floats[o + 8]));
    field.seed[i] = floats[o + 9];
    field.type[i] = Math.min(2, Math.max(0, floats[o + 10]));
    field.flags[i] = floats[o + 11];
    field.shockTag[i] = 0;
  }
  field.count = count;
  world.bodies = w.bodies.map((b) => ({ ...b, trail: b.trail.slice() }));
  world.shockwaves = w.shockwaves.map((s) => ({ ...s }));
  world.params = { ...w.params };
  world.stats = { ...w.stats };
  world.time = w.time;
  world.stepCount = w.stepCount;
  world.baseline = w.baseline || count;
  world.nextId = Math.max(
    w.nextId,
    ...world.bodies.map((b) => b.id + 1),
    ...world.shockwaves.map((s) => s.id + 1),
    1,
  );
  world.rng = new Rng(w.seed || 1);
  if (field.capacity !== PARTICLE_CAPACITY) {
    // Capacity is fixed at construction; imported counts above it are clamped.
    world.baseline = Math.min(world.baseline, field.capacity);
  }
}
