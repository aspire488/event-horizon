import { describe, expect, it } from 'vitest';
import { loadScenario } from '../core/scenarios';
import { addBody, createWorld } from '../core/world';
import type { World } from '../core/types';
import { answer, buildContext, freshMemory, localResponder, type ContextExtras } from './knowledge';

const extras: ContextExtras = {
  scenario: 'The Hungry Singularity',
  paused: false,
  speed: 1,
  tool: 'gravity',
  objectives: [
    { title: 'Stable orbit', hint: 'Keep a particle circling.', done: true, progress: 1 },
    { title: 'Event horizon', hint: 'Feed 25 particles into a black hole.', done: false, progress: 0.4 },
  ],
  recent: [{ id: 3, at: 1, kind: 'blackhole', text: 'SGR-09 opened — horizon 36 u', x: 0, y: 0 }],
  selectedId: null,
};

function world(): World {
  const w = createWorld(11, 4000);
  loadScenario(w, 'singularity', 1500);
  return w;
}

describe('Orbito knowledge', () => {
  it('builds a bounded, heaviest-first context from the live world', () => {
    const w = world();
    for (let i = 0; i < 12; i++) addBody(w, 'planet', i * 50, 0);
    const ctx = buildContext(w, extras);
    expect(ctx.bodies.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < ctx.bodies.length; i++) expect(ctx.bodies[i - 1].mass).toBeGreaterThanOrEqual(ctx.bodies[i].mass);
    expect(ctx.counts.blackhole).toBeGreaterThan(0);
    expect(ctx.particles).toBe(w.particles.count);
  });

  it('describes the actual universe', () => {
    const ctx = buildContext(world(), extras);
    const a = answer("what's happening?", ctx, freshMemory());
    expect(a.text).toContain('The Hungry Singularity');
    expect(a.text).toContain(ctx.particles.toLocaleString('en-US'));
    expect(a.text).toContain('SGR-09 opened');
  });

  it('explains black holes using real horizon numbers', () => {
    const ctx = buildContext(world(), extras);
    const hole = ctx.bodies.find((b) => b.kind === 'blackhole')!;
    const a = answer('how do black holes work here?', ctx, freshMemory());
    expect(a.text).toContain(hole.label);
    expect(a.text).toContain(`${Math.round(hole.horizon)}u horizon`);
  });

  it('answers "what if I increase its mass" about the selected body', () => {
    const w = world();
    const star = addBody(w, 'star', 500, 0, { mass: 1000, label: 'STAR-TEST' });
    const ctx = buildContext(w, { ...extras, selectedId: star.id });
    const a = answer('What if I increase its mass?', ctx, freshMemory());
    expect(a.text).toContain('STAR-TEST (selected)');
    // circular speed at 400u: sqrt(3000 * 1000 / 400) ≈ 87, doubled mass ≈ 122
    expect(a.text).toMatch(/~87 to ~122 u\/s/);
  });

  it('explains ejections with an escape-speed check', () => {
    const ctx = buildContext(world(), extras);
    const a = answer('why did that planet get ejected?', ctx, freshMemory());
    expect(a.text).toMatch(/escape speed/);
    expect(a.mood).toBe('thinking');
  });

  it('suggests the next unfinished mission', () => {
    const a = answer('give me an idea', buildContext(world(), extras), freshMemory());
    expect(a.text).toContain('Event horizon');
    expect(a.text).toContain('40%');
  });

  it('explains the last significant event for a bare "why"', () => {
    const ctx = buildContext(world(), extras);
    expect(answer('why did that happen?', ctx, freshMemory(), 'supernova').text).toMatch(/shockwave/);
    expect(answer('why did that happen?', ctx, freshMemory()).mood).toBe('confused');
  });

  it('admits what it cannot see instead of inventing', () => {
    const a = answer('what is the stock price of bananas', buildContext(world(), extras), freshMemory());
    expect(a.mood).toBe('confused');
    expect(a.text).toMatch(/only see what this universe reports/);
  });

  it('works through the async responder seam with no network or key', async () => {
    const a = await localResponder('hello', buildContext(world(), extras), freshMemory());
    expect(a.text).toMatch(/Hello/);
  });
});
