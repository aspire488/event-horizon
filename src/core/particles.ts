import type { ParticleField } from './types';

export const PARTICLE_TYPE_DUST = 0;
export const PARTICLE_TYPE_PLASMA = 1;
export const PARTICLE_TYPE_EMBER = 2;

export function createParticleField(capacity: number): ParticleField {
  return {
    capacity,
    count: 0,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    life: new Float32Array(capacity),
    maxLife: new Float32Array(capacity),
    size: new Float32Array(capacity),
    pal: new Float32Array(capacity),
    seed: new Float32Array(capacity),
    type: new Uint8Array(capacity),
    shockTag: new Uint32Array(capacity),
    flags: new Uint8Array(capacity),
  };
}

export interface ParticleSpawn {
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  pal: number;
  seed?: number;
  type?: number;
}

/** Adds a particle, recycling the oldest slot when the field is full. */
export function addParticle(field: ParticleField, p: ParticleSpawn): number {
  let index: number;
  if (field.count < field.capacity) {
    index = field.count++;
  } else {
    // Recycle a pseudo-random slot; keeps emission cheap and distribution fair.
    index = Math.floor(Math.random() * field.capacity);
  }
  writeParticle(field, index, p);
  return index;
}

export function writeParticle(field: ParticleField, index: number, p: ParticleSpawn): void {
  field.x[index] = p.x;
  field.y[index] = p.y;
  field.z[index] = p.z ?? 0;
  field.vx[index] = p.vx;
  field.vy[index] = p.vy;
  field.life[index] = p.life;
  field.maxLife[index] = p.life;
  field.size[index] = p.size;
  field.pal[index] = p.pal;
  field.seed[index] = p.seed ?? Math.random();
  field.type[index] = p.type ?? PARTICLE_TYPE_DUST;
  field.shockTag[index] = 0;
  field.flags[index] = 0;
}

/** Swap-removes a particle; order is not meaningful in the field. */
export function removeParticle(field: ParticleField, index: number): void {
  const last = --field.count;
  if (index === last) return;
  field.x[index] = field.x[last];
  field.y[index] = field.y[last];
  field.z[index] = field.z[last];
  field.vx[index] = field.vx[last];
  field.vy[index] = field.vy[last];
  field.life[index] = field.life[last];
  field.maxLife[index] = field.maxLife[last];
  field.size[index] = field.size[last];
  field.pal[index] = field.pal[last];
  field.seed[index] = field.seed[last];
  field.type[index] = field.type[last];
  field.shockTag[index] = field.shockTag[last];
  field.flags[index] = field.flags[last];
}

export function clearParticles(field: ParticleField): void {
  field.count = 0;
}
