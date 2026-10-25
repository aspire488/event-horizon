import type { World } from '../core/types';
import type { ToolId } from '../core/types';
import { bodyAtPoint } from '../core/physics';
import type { CameraRig } from '../render/camera';
import type { ToolPreview, UniverseRenderer } from '../render/renderer';
import { TOOL_PREVIEW_RADIUS } from '../tools';

export interface InteractionHost {
  getWorld(): World;
  getTool(): ToolId;
  selected(): number | null;
  getRenderer(): UniverseRenderer;
  getCamera(): CameraRig;
  previewRadius(tool: ToolId): number;
  select(id: number | null): void;
  hover(id: number | null): void;
  beginGesture(label: string): void;
  placeSource(tool: ToolId, x: number, y: number): number | null;
  placeOrbit(x: number, y: number): number | null;
  moveBody(id: number, x: number, y: number): void;
  updateOrbit(id: number, x: number, y: number): void;
  detonate(x: number, y: number): void;
  paint(x: number, y: number, fromX: number, fromY: number): void;
  setPreview(preview: ToolPreview | null): void;
  onGestureStart(): void;
}

type Mode = 'idle' | 'pan' | 'drag' | 'paint' | 'orbit' | 'pinch';

export class Interaction {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: InteractionHost;
  private mode: Mode = 'idle';
  private dragId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private pinchMidX = 0;
  private pinchMidY = 0;

  constructor(canvas: HTMLCanvasElement, host: InteractionHost) {
    this.canvas = canvas;
    this.host = host;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private worldPoint(event: PointerEvent): { x: number; y: number } | null {
    return this.host.getRenderer().screenToWorld(event.clientX, event.clientY);
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0011);
    this.host.getCamera().zoomBy(factor);
    this.updatePreview(event.clientX, event.clientY);
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.host.onGestureStart();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.canvas.setPointerCapture(event.pointerId);

    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      this.pinchMidX = (pts[0].x + pts[1].x) / 2;
      this.pinchMidY = (pts[0].y + pts[1].y) / 2;
      this.mode = 'pinch';
      this.host.setPreview(null);
      return;
    }

    const point = this.worldPoint(event);
    if (!point) return;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.worldLast = point;
    const world = this.host.getWorld();
    const tool = this.host.getTool();
    const hit = bodyAtPoint(world.bodies, point.x, point.y, 16);

    if (event.button === 1 || event.button === 2) {
      this.mode = 'pan';
      this.host.setPreview(null);
      return;
    }

    switch (tool) {
      case 'observe': {
        if (hit) {
          this.host.select(hit.id);
          this.host.beginGesture(`Move ${hit.label}`);
          this.mode = 'drag';
          this.dragId = hit.id;
        } else {
          this.host.select(null);
          this.mode = 'pan';
        }
        break;
      }
      case 'gravity':
      case 'repel':
      case 'blackhole': {
        const expected = tool === 'gravity' ? 'well' : tool === 'repel' ? 'repulsor' : 'blackhole';
        if (hit && hit.kind === expected) {
          this.host.select(hit.id);
          this.host.beginGesture(`Move ${hit.label}`);
          this.mode = 'drag';
          this.dragId = hit.id;
        } else {
          this.host.beginGesture(tool === 'blackhole' ? 'Open singularity' : 'Place force source');
          const id = this.host.placeSource(tool, point.x, point.y);
          if (id !== null) {
            this.host.select(id);
            this.mode = 'drag';
            this.dragId = id;
          }
        }
        break;
      }
      case 'supernova': {
        this.host.beginGesture('Detonate supernova');
        this.host.detonate(point.x, point.y);
        this.mode = 'idle';
        break;
      }
      case 'paint': {
        this.host.beginGesture('Paint matter');
        this.host.paint(point.x, point.y, point.x, point.y);
        this.mode = 'paint';
        break;
      }
      case 'orbit': {
        const id = this.host.placeOrbit(point.x, point.y);
        if (id !== null) {
          this.host.select(id);
          this.mode = 'orbit';
          this.dragId = id;
        }
        break;
      }
      default:
        this.mode = 'idle';
    }
    this.updatePreview(event.clientX, event.clientY);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      this.host.getCamera().panByPixels(midX - this.pinchMidX, midY - this.pinchMidY);
      this.host.getCamera().zoomBy(this.pinchDistance / distance);
      this.pinchDistance = distance;
      this.pinchMidX = midX;
      this.pinchMidY = midY;
      return;
    }

    const point = this.worldPoint(event);
    if (this.mode === 'pan') {
      this.host.getCamera().panByPixels(event.clientX - this.lastX, event.clientY - this.lastY);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      return;
    }

    if (!point) return;

    if (this.mode === 'drag' && this.dragId !== null) {
      this.host.moveBody(this.dragId, point.x, point.y);
    } else if (this.mode === 'orbit' && this.dragId !== null) {
      this.host.updateOrbit(this.dragId, point.x, point.y);
    } else if (this.mode === 'paint') {
      this.host.paint(point.x, point.y, this.worldLast?.x ?? point.x, this.worldLast?.y ?? point.y);
    }
    this.worldLast = point;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.updatePreview(event.clientX, event.clientY);
  };

  private worldLast: { x: number; y: number } | null = null;

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2 && this.mode === 'pinch') this.mode = 'idle';
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.mode !== 'pinch') this.mode = 'idle';
    this.dragId = null;
    this.worldLast = null;
    this.updatePreview(event.clientX, event.clientY);
  };

  private onPointerLeave = (): void => {
    if (this.mode === 'idle') {
      this.host.setPreview(null);
      this.host.hover(null);
    }
  };

  private updatePreview(clientX: number, clientY: number): void {
    const tool = this.host.getTool();
    if (tool === 'observe' || this.mode === 'pan' || this.mode === 'pinch') {
      this.host.setPreview(null);
      return;
    }
    const point = this.host.getRenderer().screenToWorld(clientX, clientY);
    if (!point) return;
    const world = this.host.getWorld();
    const hit = bodyAtPoint(world.bodies, point.x, point.y, 12);
    this.host.hover(hit?.id ?? null);
    this.host.setPreview({
      visible: true,
      x: point.x,
      y: point.y,
      radius: this.mode === 'idle' ? TOOL_PREVIEW_RADIUS[tool] : this.host.previewRadius(tool),
      tool,
      active: this.mode !== 'idle',
    });
  }
}
