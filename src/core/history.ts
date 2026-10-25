import type { Body, Shockwave, SimParams, SimStats, World } from './types';

const PARTICLE_STRIDE = 12;

export interface Snapshot {
  label: string;
  time: number;
  stepCount: number;
  nextId: number;
  seed: number;
  baseline: number;
  params: SimParams;
  stats: SimStats;
  bodies: Body[];
  shockwaves: Shockwave[];
  count: number;
  data: Float32Array;
}

function copyBodies(bodies: Body[]): Body[] {
  return bodies.map((b) => ({ ...b, trail: b.trail.slice() }));
}

export function captureSnapshot(world: World, label: string): Snapshot {
  const field = world.particles;
  const count = field.count;
  const data = new Float32Array(count * PARTICLE_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * PARTICLE_STRIDE;
    data[o] = field.x[i];
    data[o + 1] = field.y[i];
    data[o + 2] = field.z[i];
    data[o + 3] = field.vx[i];
    data[o + 4] = field.vy[i];
    data[o + 5] = field.life[i];
    data[o + 6] = field.maxLife[i];
    data[o + 7] = field.size[i];
    data[o + 8] = field.pal[i];
    data[o + 9] = field.seed[i];
    data[o + 10] = field.type[i];
    data[o + 11] = field.flags[i];
  }
  return {
    label,
    time: world.time,
    stepCount: world.stepCount,
    nextId: world.nextId,
    seed: world.params.seed,
    baseline: world.baseline,
    params: { ...world.params },
    stats: { ...world.stats },
    bodies: copyBodies(world.bodies),
    shockwaves: world.shockwaves.map((s) => ({ ...s })),
    count,
    data,
  };
}

export function restoreSnapshot(world: World, snap: Snapshot): void {
  const field = world.particles;
  const count = Math.min(snap.count, field.capacity);
  for (let i = 0; i < count; i++) {
    const o = i * PARTICLE_STRIDE;
    field.x[i] = snap.data[o];
    field.y[i] = snap.data[o + 1];
    field.z[i] = snap.data[o + 2];
    field.vx[i] = snap.data[o + 3];
    field.vy[i] = snap.data[o + 4];
    field.life[i] = snap.data[o + 5];
    field.maxLife[i] = snap.data[o + 6];
    field.size[i] = snap.data[o + 7];
    field.pal[i] = snap.data[o + 8];
    field.seed[i] = snap.data[o + 9];
    field.type[i] = snap.data[o + 10];
    field.flags[i] = snap.data[o + 11];
    field.shockTag[i] = 0;
  }
  field.count = count;
  world.bodies = copyBodies(snap.bodies);
  world.shockwaves = snap.shockwaves.map((s) => ({ ...s }));
  world.params = { ...snap.params, seed: snap.seed };
  world.stats = { ...snap.stats };
  world.time = snap.time;
  world.stepCount = snap.stepCount;
  world.nextId = snap.nextId;
  world.baseline = snap.baseline;
}

/** Undo/redo over user edits (object-level and matter-level). */
export class HistoryStack {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  constructor(private readonly limit = 14) {}

  record(label: string, world: World): void {
    this.undoStack.push(captureSnapshot(world, label));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(world: World): string | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(captureSnapshot(world, snap.label));
    if (this.redoStack.length > this.limit) this.redoStack.shift();
    restoreSnapshot(world, snap);
    return snap.label;
  }

  redo(world: World): string | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(captureSnapshot(world, snap.label));
    restoreSnapshot(world, snap);
    return snap.label;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export interface Keyframe {
  at: number;
  label: string;
  snapshot: Snapshot;
}

/**
 * Periodic full-state keyframes. The rewind bar restores a real snapshot; it
 * cannot reverse physics exactly between keyframes, and the UI says so.
 */
export class Timeline {
  readonly keyframes: Keyframe[] = [];

  constructor(
    private readonly capacity = 10,
    private readonly interval = 3,
  ) {}

  maybeCapture(world: World, force = false): Keyframe | null {
    const last = this.keyframes[this.keyframes.length - 1];
    if (!force && last && world.time - last.at < this.interval) return null;
    if (!force && world.time <= 0.001) return null;
    const frame: Keyframe = {
      at: world.time,
      label: `${world.time.toFixed(1)} s`,
      snapshot: captureSnapshot(world, `${world.time.toFixed(1)} s`),
    };
    this.keyframes.push(frame);
    if (this.keyframes.length > this.capacity) this.keyframes.shift();
    return frame;
  }

  /**
   * Restores a snapshot and discards snapshots from the abandoned future, so
   * continued simulation branches from the restored state instead of silently
   * retaining a timeline that no longer matches the universe.
   */
  restore(world: World, index: number): number {
    const frame = this.keyframes[index];
    if (!frame) return -1;
    restoreSnapshot(world, frame.snapshot);
    this.keyframes.length = index + 1;
    return frame.at;
  }

  clear(): void {
    this.keyframes.length = 0;
  }
}
