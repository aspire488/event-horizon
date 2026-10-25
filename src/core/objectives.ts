import type { World } from './types';
import { findBody } from './world';

export interface Objective {
  id: string;
  title: string;
  hint: string;
  target: number;
  done: boolean;
  progress: number;
}

interface OrbitTrack {
  index: number;
  bodyId: number;
  radius: number;
  angle: number;
  accumulated: number;
  age: number;
}

const TWO_PI = Math.PI * 2;

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TWO_PI;
  while (x < -Math.PI) x += TWO_PI;
  return x;
}

export class ObjectiveTracker {
  objectives: Objective[] = this.fresh();
  private tracks: OrbitTrack[] = [];
  private timer = 0;

  private fresh(): Objective[] {
    return [
      {
        id: 'orbit',
        title: 'Stable orbit',
        hint: 'Keep a particle circling one body for a full revolution.',
        target: TWO_PI,
        done: false,
        progress: 0,
      },
      {
        id: 'capture',
        title: 'Event horizon',
        hint: 'Feed 25 particles into a black hole.',
        target: 25,
        done: false,
        progress: 0,
      },
      {
        id: 'collision',
        title: 'Cataclysmic merge',
        hint: 'Drive two massive bodies into each other.',
        target: 1,
        done: false,
        progress: 0,
      },
      {
        id: 'shockwave',
        title: 'Shockwave',
        hint: 'Sweep 150 particles with a supernova front.',
        target: 150,
        done: false,
        progress: 0,
      },
      {
        id: 'slingshot',
        title: 'Gravitational slingshot',
        hint: 'Fling a particle fast past a massive body.',
        target: 1,
        done: false,
        progress: 0,
      },
    ];
  }

  reset(): void {
    this.tracks.length = 0;
    this.timer = 0;
    this.objectives = this.fresh();
  }

  /** Drops orbit tracking after a state restore; completed objectives survive. */
  resetTracking(): void {
    this.tracks.length = 0;
    this.timer = 0;
  }

  evaluate(world: World, dt: number): Objective[] {
    this.timer += dt;
    if (this.timer >= 0.3) {
      this.timer = 0;
      this.sampleOrbits(world);
    }

    const stats = world.stats;
    const values: Record<string, number> = {
      orbit: this.bestOrbit(),
      capture: stats.absorbedByBlackHole / 25,
      collision: stats.merged / 1,
      shockwave: stats.shockedParticles / 150,
      slingshot: stats.slingshots / 1,
    };

    const completed: Objective[] = [];
    for (const obj of this.objectives) {
      const p = Math.max(0, Math.min(1, values[obj.id] ?? 0));
      obj.progress = p;
      if (!obj.done && p >= 1) {
        obj.done = true;
        completed.push(obj);
      }
    }
    return completed;
  }

  private bestOrbit(): number {
    let best = 0;
    for (const t of this.tracks) best = Math.max(best, Math.abs(t.accumulated) / TWO_PI);
    return best;
  }

  private sampleOrbits(world: World): void {
    const field = world.particles;

    for (let i = this.tracks.length - 1; i >= 0; i--) {
      const t = this.tracks[i];
      const body = findBody(world, t.bodyId);
      t.age += 0.3;
      if (!body || t.index >= field.count || t.age > 90) {
        this.tracks.splice(i, 1);
        continue;
      }
      const dx = field.x[t.index] - body.x;
      const dy = field.y[t.index] - body.y;
      const r = Math.hypot(dx, dy);
      if (r < 1 || Math.abs(r - t.radius) > t.radius * 0.22) {
        if (Math.abs(t.accumulated) < TWO_PI * 0.5) this.tracks.splice(i, 1);
        continue;
      }
      const angle = Math.atan2(dy, dx);
      const delta = wrapAngle(angle - t.angle);
      if (Math.abs(delta) < 0.7) t.accumulated += delta;
      t.angle = angle;
    }

    if (this.tracks.length >= 24) return;

    const stride = Math.max(1, Math.floor(field.count / 700));
    for (let i = 0; i < field.count && this.tracks.length < 24; i += stride) {
      if (this.tracks.some((t) => t.index === i)) continue;
      const px = field.x[i];
      const py = field.y[i];
      let bestBody: { id: number; x: number; y: number; r: number; mass: number } | null = null;
      let bestScore = Infinity;
      for (const body of world.bodies) {
        if (body.mass < 200 || body.kind === 'blackhole') continue;
        const r = Math.hypot(px - body.x, py - body.y);
        if (r < body.radius * 3.5 || r > 2200) continue;
        const score = Math.abs(r - 400);
        if (score < bestScore) {
          bestScore = score;
          bestBody = { id: body.id, x: body.x, y: body.y, r, mass: body.mass };
        }
      }
      if (!bestBody) continue;
      const dx = px - bestBody.x;
      const dy = py - bestBody.y;
      const radial = (dx * field.vx[i] + dy * field.vy[i]) / bestBody.r;
      const tangential = (dx * field.vy[i] - dy * field.vx[i]) / bestBody.r;
      if (Math.abs(radial) > Math.abs(tangential) * 0.45) continue;
      if (Math.abs(tangential) < 12) continue;
      this.tracks.push({
        index: i,
        bodyId: bestBody.id,
        radius: bestBody.r,
        angle: Math.atan2(dy, dx),
        accumulated: 0,
        age: 0,
      });
    }
  }
}
