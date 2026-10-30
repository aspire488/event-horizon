import type { Rng } from './rng';

export type BodyKind = 'star' | 'planet' | 'blackhole' | 'well' | 'repulsor';

/** Force-lab editable numbers attached to a single body. */
export interface Body {
  id: number;
  kind: BodyKind;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravitational mass. Zero for repulsors-only visuals? Never negative. */
  mass: number;
  /** Drawn radius in world units. Black holes use this for their event horizon. */
  radius: number;
  /** Cutoff radius for well / repulsor forces. `0` means unbounded (stars, holes). */
  influence: number;
  /** Force multiplier for wells and repulsors. */
  strength: number;
  /** Remaining lifetime in seconds. `-1` means stable. */
  life: number;
  maxLife: number;
  /** Visual hue slot, 0 amber / 1 cyan / 2 violet / 3 stellar white / 4 hot. */
  hue: number;
  /** Visual spin in radians (accretion discs, planet rings). */
  spin: number;
  /** Small per-body random offset so no two bodies animate identically. */
  seed: number;
  /** Recent path samples, flat [x, y, x, y, ...] oldest first. */
  trail: number[];
}

export interface Shockwave {
  id: number;
  x: number;
  y: number;
  radius: number;
  prevRadius: number;
  speed: number;
  strength: number;
  width: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  hue: number;
}

export interface SimParams {
  /** Gravitational constant in simulation units. */
  gravity: number;
  /** Simulation speed multiplier applied on top of the fixed timestep. */
  speed: number;
  /** Force softening length, prevents singular accelerations. */
  soften: number;
  /** Visual trail length 0..1. */
  trailLength: number;
  /** Optional deterministic seed (used by scenarios / exports). */
  seed: number;
}

export interface SimStats {
  absorbed: number;
  absorbedByBlackHole: number;
  merged: number;
  supernovas: number;
  shockedParticles: number;
  slingshots: number;
  emitted: number;
}

/** Fixed-capacity structure-of-arrays particle field. */
export interface ParticleField {
  capacity: number;
  count: number;
  /** Round-robin cursor used only when the field is saturated (deterministic). */
  recycle: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Seconds of life left. */
  life: Float32Array;
  maxLife: Float32Array;
  /** Rendered point size in world units. */
  size: Float32Array;
  /** Palette index; read by the renderer shader. */
  pal: Float32Array;
  /** Random scalar used for twinkle / variation. */
  seed: Float32Array;
  /** 0 dust, 1 plasma, 2 stellar ember. */
  type: Uint8Array;
  /** Tag of the last shockwave that moved this particle (dedupe counter). */
  shockTag: Uint32Array;
  /** Bit flags: 1 = already counted as a gravitational slingshot. */
  flags: Uint8Array;
}

export interface World {
  bodies: Body[];
  particles: ParticleField;
  shockwaves: Shockwave[];
  params: SimParams;
  stats: SimStats;
  /** Simulation time in seconds. */
  time: number;
  /** Number of fixed physics steps executed. */
  stepCount: number;
  nextId: number;
  rng: Rng;
  /** Particle count the initial state was seeded with; used for density readouts. */
  baseline: number;
}

export type ToolId = 'observe' | 'gravity' | 'blackhole' | 'supernova' | 'repel' | 'paint' | 'orbit';

export type QualityLevel = 'auto' | 'cinematic' | 'balanced' | 'performance';

/** Concrete rendering tiers. `'auto'` is resolved to one of these at runtime. */
export type RenderQuality = Exclude<QualityLevel, 'auto'>;

/** Tier ladder ordered weakest → strongest. */
export const RENDER_QUALITIES: readonly RenderQuality[] = ['performance', 'balanced', 'cinematic'];

export function isRenderQuality(value: QualityLevel): value is RenderQuality {
  return value !== 'auto';
}

/** Steps one rung up/down the ladder; returns null at the ends. */
export function stepQuality(current: RenderQuality, direction: 1 | -1): RenderQuality | null {
  const index = RENDER_QUALITIES.indexOf(current);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= RENDER_QUALITIES.length) return null;
  return RENDER_QUALITIES[next];
}

export type EventKind =
  | 'blackhole'
  | 'absorb'
  | 'merge'
  | 'supernova'
  | 'shockwave'
  | 'collapse'
  | 'discovery'
  | 'capture'
  | 'reset';

export interface CosmicEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
  x: number;
  y: number;
}
