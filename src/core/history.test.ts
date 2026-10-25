import { describe, expect, it } from 'vitest';
import { HistoryStack, Timeline } from './history';
import { addBody, createWorld, PALETTE } from './world';
import { addParticle } from './particles';

describe('HistoryStack', () => {
  it('restores object and matter state on undo and redo', () => {
    const world = createWorld(9, 256);
    const star = addBody(world, 'star', 100, 0, { mass: 900 });
    addParticle(world.particles, { x: 10, y: 20, vx: 1, vy: 2, life: 100, size: 2, pal: PALETTE.white });
    const history = new HistoryStack();

    history.record('Adjust star', world);
    star.mass = 4200;
    world.particles.count = 0;

    expect(history.undo(world)).toBe('Adjust star');
    expect(world.bodies[0].mass).toBe(900);
    expect(world.particles.count).toBe(1);
    expect(history.canRedo).toBe(true);

    expect(history.redo(world)).toBe('Adjust star');
    expect(world.bodies[0].mass).toBe(4200);
    expect(world.particles.count).toBe(0);
  });

  it('clears the redo branch when a new action is recorded', () => {
    const world = createWorld(9, 256);
    addBody(world, 'star', 0, 0, { mass: 900 });
    const history = new HistoryStack();
    history.record('one', world);
    world.bodies[0].mass = 1200;
    history.undo(world);
    expect(history.canRedo).toBe(true);
    history.record('two', world);
    expect(history.canRedo).toBe(false);
  });

  it('limits the undo depth', () => {
    const world = createWorld(9, 128);
    const history = new HistoryStack(2);
    history.record('a', world);
    history.record('b', world);
    history.record('c', world);
    expect(history.undo(world)).toBe('c');
    expect(history.undo(world)).toBe('b');
    expect(history.undo(world)).toBeNull();
  });
});

describe('Timeline', () => {
  it('captures snapshots on an interval and restores them', () => {
    const world = createWorld(10, 128);
    addBody(world, 'star', 0, 0, { mass: 900 });
    world.time = 0;
    const timeline = new Timeline(5, 2);
    expect(timeline.maybeCapture(world, true)).not.toBeNull();
    world.time = 2.5;
    world.bodies[0].x = 500;
    expect(timeline.maybeCapture(world)).not.toBeNull();
    expect(timeline.keyframes).toHaveLength(2);
    expect(timeline.restore(world, 0)).toBe(0);
    expect(world.bodies[0].x).toBe(0);
    // Restoring an earlier frame abandons the future branch.
    expect(timeline.keyframes).toHaveLength(1);
    expect(timeline.restore(world, 9)).toBe(-1);
  });

  it('does not capture more often than the interval', () => {
    const world = createWorld(11, 128);
    world.time = 5;
    const timeline = new Timeline(5, 3);
    expect(timeline.maybeCapture(world)).not.toBeNull();
    world.time = 6;
    expect(timeline.maybeCapture(world)).toBeNull();
    world.time = 8.1;
    expect(timeline.maybeCapture(world)).not.toBeNull();
  });

  it('keeps only the most recent keyframes', () => {
    const world = createWorld(12, 64);
    const timeline = new Timeline(3, 1);
    for (let t = 0; t < 6; t++) {
      world.time = t;
      timeline.maybeCapture(world);
    }
    expect(timeline.keyframes).toHaveLength(3);
    expect(timeline.keyframes[2].at).toBe(5);
  });
});
