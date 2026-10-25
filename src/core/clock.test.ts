import { describe, expect, it, vi } from 'vitest';
import { FIXED_STEP, SimClock } from './clock';

describe('SimClock', () => {
  it('emits fixed steps from accumulated frame time', () => {
    const clock = new SimClock();
    const step = vi.fn();
    clock.advance(1 / 60, step);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step.mock.calls[0][0]).toBeCloseTo(FIXED_STEP, 10);
  });

  it('does not advance while paused and clears its backlog', () => {
    const clock = new SimClock();
    clock.paused = true;
    const step = vi.fn();
    clock.advance(0.5, step);
    expect(step).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
  });

  it('scales with simulation speed', () => {
    const clock = new SimClock();
    clock.speed = 2;
    const step = vi.fn();
    const steps = clock.advance(FIXED_STEP, step);
    expect(steps).toBe(2);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('caps the steps per frame and drops the unpayable backlog', () => {
    const clock = new SimClock();
    const step = vi.fn();
    const steps = clock.advance(1, step, 4);
    expect(steps).toBe(4);
    expect(clock.pending).toBeLessThanOrEqual(FIXED_STEP * 2 + 1e-9);
  });

  it('never overshoots a paused resume', () => {
    const clock = new SimClock();
    const step = vi.fn();
    clock.advance(0.08, step);
    clock.paused = true;
    clock.advance(5, step);
    clock.paused = false;
    clock.advance(0, step);
    expect(step).toHaveBeenCalledTimes(4);
  });
});
