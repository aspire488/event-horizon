import { describe, expect, it } from 'vitest';
import {
  applyExperiment,
  experimentToJSON,
  MAX_IMPORT_BYTES,
  parseExperiment,
  serializeExperiment,
  serializeWorld,
} from './serialize';
import { addBody, createWorld } from './world';
import { loadScenario } from './scenarios';
import { stepWorld } from './physics';

function encode(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('experiment serialization', () => {
  it('round-trips a populated universe through JSON', () => {
    const world = createWorld(1, 8000);
    loadScenario(world, 'binary', 1600);
    addBody(world, 'well', 300, 1900, { mass: 820, influence: 510, strength: 1.4 });
    for (let i = 0; i < 120; i++) stepWorld(world, 1 / 60);
    const doc = serializeExperiment(world, 'Round trip');
    const parsed = parseExperiment(experimentToJSON(doc));
    const restored = createWorld(2, 8000);
    applyExperiment(restored, parsed);

    expect(restored.bodies).toHaveLength(world.bodies.length);
    expect(restored.particles.count).toBe(world.particles.count);
    expect(restored.params.gravity).toBe(world.params.gravity);
    expect(restored.time).toBeCloseTo(world.time, 5);
    expect(restored.bodies.find((b) => b.kind === 'well')?.mass).toBeCloseTo(820, 3);
    // The restored universe keeps evolving exactly like the original.
    stepWorld(world, 1 / 60);
    stepWorld(restored, 1 / 60);
    expect(restored.particles.x[0]).toBeCloseTo(world.particles.x[0], 3);
    expect(restored.particles.y[0]).toBeCloseTo(world.particles.y[0], 3);
  });

  it('caps saved particles at the documented limit', () => {
    const world = createWorld(4, 100);
    for (let i = 0; i < 100; i++) {
      world.particles.count += 1;
      world.particles.x[i] = i;
      world.particles.life[i] = 10;
      world.particles.maxLife[i] = 10;
    }
    const data = serializeWorld(world);
    expect(data.particles.count).toBe(100);
    expect(data.particles.data.length).toBeGreaterThan(100);
  });

  it('rejects malformed input with useful messages', () => {
    expect(() => parseExperiment('')).toThrow(/empty/i);
    expect(() => parseExperiment('{not json')).toThrow(/JSON/i);
    expect(() => parseExperiment('{"app":"other"}')).toThrow(/not a GOD MODE/i);
    expect(() =>
      parseExperiment(JSON.stringify({ app: 'god-mode', schema: 99, world: { particles: { count: 0, data: '' } } })),
    ).toThrow(/schema/i);
    expect(() =>
      parseExperiment(JSON.stringify({ app: 'god-mode', schema: 1 })),
    ).toThrow(/universe data/i);
    expect(() =>
      parseExperiment(
        JSON.stringify({
          app: 'god-mode',
          schema: 1,
          world: { particles: { count: 5, data: btoa('') }, bodies: [], shockwaves: [] },
        }),
      ),
    ).toThrow(/truncated/i);
    expect(() => parseExperiment('x'.repeat(MAX_IMPORT_BYTES + 10))).toThrow(/large/i);
  });

  it('rejects non-finite particle data', () => {
    const values = new Float32Array(12);
    values[0] = Number.NaN;
    const doc = {
      app: 'god-mode',
      schema: 1,
      name: 'bad',
      createdAt: 0,
      updatedAt: 0,
      world: {
        particles: { count: 1, data: encode(values) },
        bodies: [],
        shockwaves: [],
        params: {},
        stats: {},
      },
    };
    expect(() => parseExperiment(JSON.stringify(doc))).toThrow(/invalid values/i);
  });

  it('sanitises out-of-range body values instead of crashing', () => {
    const world = createWorld(5, 64);
    loadScenario(world, 'singularity', 800);
    const doc = JSON.parse(experimentToJSON(serializeExperiment(world, 'clamp')));
    doc.world.bodies[0].mass = 1e12;
    doc.world.bodies[0].radius = -50;
    doc.world.bodies[0].kind = 'not-a-kind';
    const parsed = parseExperiment(JSON.stringify(doc));
    expect(parsed.world.bodies[0].mass).toBeLessThanOrEqual(200_000);
    expect(parsed.world.bodies[0].radius).toBeGreaterThan(0);
    expect(parsed.world.bodies[0].kind).toBe('planet');
  });
});
