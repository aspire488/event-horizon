import type { ToolId } from './core/types';

export interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  hint: string;
  /** Screen-space cursor used on the canvas. */
  cursor: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: 'observe',
    name: 'Observe',
    key: '1',
    hint: 'Click a body to inspect it, drag to move it. Drag empty space to pan.',
    cursor: 'default',
  },
  {
    id: 'gravity',
    name: 'Gravity',
    key: '2',
    hint: 'Click to drop a gravity well. Drag to reposition it.',
    cursor: 'crosshair',
  },
  {
    id: 'blackhole',
    name: 'Black Hole',
    key: '3',
    hint: 'Click to open a singularity. Matter inside the horizon is consumed.',
    cursor: 'crosshair',
  },
  {
    id: 'supernova',
    name: 'Supernova',
    key: '4',
    hint: 'Click to detonate. The expanding front accelerates everything it crosses.',
    cursor: 'crosshair',
  },
  {
    id: 'repel',
    name: 'Repel',
    key: '5',
    hint: 'Click to place a repulsor. Matter is pushed out to its influence radius.',
    cursor: 'crosshair',
  },
  {
    id: 'paint',
    name: 'Paint',
    key: '6',
    hint: 'Drag to stream matter into space. Faster strokes fire faster matter.',
    cursor: 'crosshair',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    key: '7',
    hint: 'Click to launch a planet on a circular orbit around the nearest mass.',
    cursor: 'crosshair',
  },
];

export function toolById(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}

/** Visual radius of the pointer preview per tool. */
export const TOOL_PREVIEW_RADIUS: Record<ToolId, number> = {
  observe: 0,
  gravity: 470,
  blackhole: 110,
  supernova: 260,
  repel: 430,
  paint: 46,
  orbit: 220,
};
