/** Physics runs at a fixed rate; rendering runs at whatever the display allows. */
export const FIXED_STEP = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Accumulates real frame time and hands out fixed simulation steps so that
 * behaviour is independent of display refresh rate. Pausing clears the
 * accumulator so resuming never "catches up" with a burst of physics.
 */
export class SimClock {
  paused = false;
  speed = 1;
  private accumulator = 0;

  reset(): void {
    this.accumulator = 0;
  }

  get pending(): number {
    return this.accumulator;
  }

  /**
   * Advances time by `frameSeconds` scaled by speed, invoking `step` for each
   * fixed timestep. Returns the number of steps executed.
   */
  advance(frameSeconds: number, step: (dt: number) => void, maxSteps = MAX_STEPS_PER_FRAME): number {
    if (this.paused) {
      this.accumulator = 0;
      return 0;
    }
    const clamped = Math.min(Math.max(frameSeconds, 0), 0.1);
    this.accumulator += clamped * this.speed;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < maxSteps) {
      step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    // Never let a stalled tab build an unpayable debt.
    if (steps >= maxSteps) this.accumulator = Math.min(this.accumulator, FIXED_STEP * 2);
    return steps;
  }
}

export const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4] as const;
