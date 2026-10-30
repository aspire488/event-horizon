import { describe, expect, it } from 'vitest';
import { addParticle, createParticleField, removeParticle } from './particles';
import { PALETTE } from './world';

function spawn(x: number) {
  return { x, y: -x, vx: 1, vy: 2, life: 10, size: 2, pal: PALETTE.white, seed: x / 100 };
}

describe('particle field recycling', () => {
  it('fills sequentially, then recycles round-robin deterministically', () => {
    const f = createParticleField(4);
    for (let i = 0; i < 4; i++) expect(addParticle(f, spawn(i))).toBe(i);
    expect(f.count).toBe(4);
    expect(f.recycle).toBe(0);
    // Saturated: subsequent adds walk the round-robin cursor 0, 1, 2, ...
    expect(addParticle(f, spawn(40))).toBe(0);
    expect(addParticle(f, spawn(50))).toBe(1);
    expect(addParticle(f, spawn(60))).toBe(2);
    expect(f.recycle).toBe(3);
    expect(f.count).toBe(4); // capacity never exceeded
    expect(f.x[0]).toBe(40);
    expect(f.x[1]).toBe(50);
    expect(f.x[2]).toBe(60);
  });

  it('produces identical fields for identical spawn sequences', () => {
    const a = createParticleField(8);
    const b = createParticleField(8);
    for (let i = 0; i < 20; i++) {
      addParticle(a, spawn(i));
      addParticle(b, spawn(i));
    }
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
    expect(Array.from(a.vx)).toEqual(Array.from(b.vx));
    expect(Array.from(a.seed)).toEqual(Array.from(b.seed));
    expect(a.recycle).toBe(b.recycle);
    expect(a.count).toBe(b.count);
  });

  it('uses the provided seed instead of hidden randomness', () => {
    const f = createParticleField(2);
    addParticle(f, { ...spawn(7), seed: 0.123 });
    // Seeds live in a Float32Array, so compare at f32 precision.
    expect(f.seed[0]).toBeCloseTo(0.123, 6);
  });

  it('swap-removes without corrupting remaining slots', () => {
    const f = createParticleField(8);
    for (let i = 1; i <= 5; i++) addParticle(f, spawn(i));
    removeParticle(f, 1); // removes x=2; the last slot (x=5) moves into slot 1
    expect(f.count).toBe(4);
    expect(f.x[1]).toBe(5);
    expect(f.vx[1]).toBe(spawn(5).vx);
    expect(f.seed[1]).toBeCloseTo(spawn(5).seed, 6);
  });
});
