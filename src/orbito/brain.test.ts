import { describe, expect, it } from 'vitest';
import { EventLog } from '../core/events';
import { loadScenario } from '../core/scenarios';
import type { CosmicEvent, EventKind } from '../core/types';
import { createWorld } from '../core/world';
import { GLOBAL_GAP_S, MOODS, OrbitoBrain } from './brain';
import { buildContext, type OrbitoContext } from './knowledge';

function ctx(): OrbitoContext {
  const world = createWorld(7, 4000);
  loadScenario(world, 'prime', 1500);
  return buildContext(world, {
    scenario: 'Prime Field', paused: false, speed: 1, tool: 'gravity', objectives: [], recent: [], selectedId: null,
  });
}

let nextId = 1;
function ev(kind: EventKind, text: string = kind): CosmicEvent {
  return { id: nextId++, at: 0, kind, text, x: 0, y: 0 };
}

describe('OrbitoBrain', () => {
  const c = ctx();

  it('reacts to a user black hole with a surprised line', () => {
    const b = new OrbitoBrain();
    const r = b.observe({ type: 'event', event: ev('blackhole') }, 100, c);
    expect(r?.mood).toBe('surprised');
    expect(r?.line).toMatch(/\w/);
    expect(b.moodAt(101)).toBe('surprised');
    expect(b.moodAt(200)).toBe('idle'); // expression decays
  });

  it('drops duplicate deliveries of the same event', () => {
    const b = new OrbitoBrain();
    const e = ev('merge', 'PLANET-02 merged into STAR-01');
    expect(b.observe({ type: 'event', event: e }, 10, c)).not.toBeNull();
    expect(b.observe({ type: 'event', event: e }, 200, c)).toBeNull();
    expect(b.memory.merges).toBe(1);
  });

  it('rate-limits lines globally but still changes expression', () => {
    const b = new OrbitoBrain();
    const first = b.observe({ type: 'event', event: ev('blackhole') }, 100, c);
    const second = b.observe({ type: 'event', event: ev('collapse') }, 101, c);
    expect(first?.line).not.toBeNull();
    expect(second?.line).toBeNull();
    expect(second?.mood).toBe('surprised');
    const third = b.observe({ type: 'event', event: ev('collapse') }, 101 + GLOBAL_GAP_S, c);
    expect(third?.line).not.toBeNull();
  });

  it('applies per-category cooldowns to frequent events', () => {
    const b = new OrbitoBrain();
    expect(b.observe({ type: 'event', event: ev('slingshot') }, 0, c)?.line).not.toBeNull();
    expect(b.observe({ type: 'event', event: ev('slingshot') }, 20, c)?.line).toBeNull(); // 45s cooldown
    expect(b.observe({ type: 'event', event: ev('slingshot') }, 46, c)?.line).not.toBeNull();
  });

  it('never repeats the same line back to back', () => {
    const b = new OrbitoBrain();
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = b.observe({ type: 'event', event: ev('blackhole') }, i * 1000, c);
      // reset demolition counting with a world reset in between
      b.observe({ type: 'event', event: ev('reset', 'PRIME FIELD online · 1 particles') }, i * 1000 + 500, c);
      if (r?.line) lines.push(r.line);
    }
    expect(lines.length).toBe(6);
    for (let i = 1; i < lines.length; i++) expect(lines[i]).not.toBe(lines[i - 1]);
  });

  it('gets sarcastic about repeated demolition', () => {
    const b = new OrbitoBrain();
    let last = null;
    for (let i = 0; i < 4; i++) last = b.observe({ type: 'event', event: ev('blackhole') }, i * 15, c);
    expect(last?.mood).toBe('amused');
    expect(last?.line).toMatch(/demolition|destruction|lawyer/);
  });

  it('celebrates discoveries even in quiet mode and flags a notification', () => {
    const b = new OrbitoBrain();
    b.quiet = true;
    expect(b.observe({ type: 'event', event: ev('blackhole') }, 0, c)?.line).toBeNull();
    const d = b.observe({ type: 'event', event: ev('discovery', 'Discovery — Stable orbit') }, 5, c);
    expect(d?.mood).toBe('celebrating');
    expect(d?.notify).toBe(true);
    expect(d?.line).toContain('Stable orbit');
  });

  it('names the scenario from the reset event text', () => {
    const b = new OrbitoBrain();
    const r = b.observe({ type: 'event', event: ev('reset', 'THE HUNGRY SINGULARITY online · 6,808 particles') }, 0, c);
    expect(r?.line).toContain('The Hungry Singularity');
  });

  it('relaxes on pause, does not nag while paused, and wakes on resume', () => {
    const b = new OrbitoBrain();
    expect(b.observe({ type: 'paused' }, 0, c)?.mood).toBe('idle');
    expect(b.observe({ type: 'idle' }, 100, c)).toBeNull();
    expect(b.observe({ type: 'event', event: ev('slingshot') }, 100, c)).toBeNull();
    expect(b.observe({ type: 'resumed' }, 101, c)?.mood).toBe('curious');
  });

  it('falls asleep after inactivity and wakes on activity', () => {
    const b = new OrbitoBrain();
    expect(b.observe({ type: 'activity' }, 0, c)).toBeNull(); // awake already: nothing to do
    b.observe({ type: 'sleep' }, 10, c);
    expect(b.moodAt(11)).toBe('sleepy');
    expect(b.observe({ type: 'activity' }, 12, c)?.mood).toBe('surprised');
    expect(b.moodAt(100)).toBe('idle');
  });

  it('keeps observations bounded', () => {
    const b = new OrbitoBrain();
    for (let i = 0; i < 50; i++) b.observe({ type: 'event', event: ev('absorb') }, i, c);
    expect(b.observations.length).toBeLessThanOrEqual(8);
  });

  it('attributes by kind: collapse is natural, capture is a black-hole meal', () => {
    const b = new OrbitoBrain();
    expect(b.observe({ type: 'event', event: ev('collapse', 'STAR-01 collapsed') }, 0, c)?.line).toMatch(/Nobody touched|collapse/i);
    expect(b.memory.novas).toBe(0);
    expect(b.observe({ type: 'event', event: ev('capture', 'SGR-01 swallowed STAR-02') }, 20, c)?.mood).toBe('concerned');
  });

  it('introduces each tool once, and only once it was actually said', () => {
    const b = new OrbitoBrain();
    b.quiet = true;
    expect(b.observe({ type: 'tool', tool: 'paint' }, 0, c)?.line).toBeNull();
    b.quiet = false;
    expect(b.observe({ type: 'tool', tool: 'paint' }, 5, c)?.line).toMatch(/Paint/);
    expect(b.observe({ type: 'tool', tool: 'paint' }, 50, c)).toBeNull();
  });

  it('exposes all ten required moods', () => {
    expect(MOODS).toHaveLength(10);
  });
});

describe('EventLog.subscribe', () => {
  it('delivers recorded events, skips suppressed ones, and unsubscribes cleanly', () => {
    const log = new EventLog();
    const seen: number[] = [];
    const off = log.subscribe((e) => seen.push(e.id));
    log.push('absorb', 'a', 0, 0, 1, 'hole', 3);
    log.push('absorb', 'b', 0, 0, 2, 'hole', 3); // suppressed by cooldown
    off();
    log.push('merge', 'c', 0, 0, 9);
    expect(seen).toEqual([1]);
  });
});
