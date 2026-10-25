import * as THREE from 'three';

const FOV_RAD = (45 * Math.PI) / 180;
const MIN_DISTANCE = 480;
const MAX_DISTANCE = 16000;
const LIMIT = 14000;

/** Smoothed 2D camera over the simulation plane with a faint tilt for depth. */
export class CameraRig {
  targetX = 0;
  targetY = 0;
  distance = 3200;

  private goalX = 0;
  private goalY = 0;
  private goalDistance = 3200;
  private readonly camera: THREE.PerspectiveCamera;
  private viewportHeight = 900;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.apply();
  }

  get fov(): number {
    return FOV_RAD;
  }

  setViewport(height: number): void {
    this.viewportHeight = Math.max(1, height);
  }

  get unitsPerPixel(): number {
    return (2 * this.distance * Math.tan(FOV_RAD / 2)) / this.viewportHeight;
  }

  panByPixels(dx: number, dy: number): void {
    const k = this.unitsPerPixel;
    this.goalX = clamp(this.goalX - dx * k, -LIMIT, LIMIT);
    this.goalY = clamp(this.goalY + dy * k, -LIMIT, LIMIT);
  }

  zoomBy(factor: number): void {
    this.goalDistance = clamp(this.goalDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  }

  zoomTo(distance: number): void {
    this.goalDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
  }

  focus(x: number, y: number, distance?: number): void {
    this.goalX = clamp(x, -LIMIT, LIMIT);
    this.goalY = clamp(y, -LIMIT, LIMIT);
    if (distance !== undefined) this.goalDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
  }

  snap(x: number, y: number, distance: number): void {
    this.goalX = clamp(x, -LIMIT, LIMIT);
    this.goalY = clamp(y, -LIMIT, LIMIT);
    this.goalDistance = clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    this.targetX = this.goalX;
    this.targetY = this.goalY;
    this.distance = this.goalDistance;
    this.apply();
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 9);
    this.targetX += (this.goalX - this.targetX) * k;
    this.targetY += (this.goalY - this.targetY) * k;
    this.distance += (this.goalDistance - this.distance) * (1 - Math.exp(-dt * 6));
    this.apply();
  }

  private apply(): void {
    this.camera.position.set(this.targetX, this.targetY - this.distance * 0.085, this.distance);
    this.camera.lookAt(this.targetX, this.targetY, 0);
    this.camera.updateMatrixWorld();
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
