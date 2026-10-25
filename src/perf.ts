export class PerfMonitor {
  fps = 0;
  frameMs = 0;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.frames += 1;
    this.elapsed += dt;
    this.frameMs = Math.max(this.frameMs * 0.9, dt * 1000 * 0.1);
    const instant = dt * 1000;
    this.worst = Math.max(this.worst, instant);
    if (this.elapsed >= 0.5) {
      this.fps = this.frames / this.elapsed;
      this.frames = 0;
      this.elapsed = 0;
    }
  }

  get worstMs(): number {
    return this.worst;
  }

  resetWorst(): void {
    this.worst = 0;
  }

  /** A simple, honest hint: sustained low FPS suggests dropping quality. */
  suggestsLowerQuality(): boolean {
    return this.fps > 0 && this.fps < 42;
  }
}
