import {
  parseExperiment,
  serializeExperiment,
  type ExperimentDoc,
} from './core/serialize';
import { createWorld } from './core/world';
import { loadScenario } from './core/scenarios';
import type { QualityLevel, World } from './core/types';

const SAVES_KEY = 'godmode.saves.v1';
const PREFS_KEY = 'godmode.prefs.v1';
const SEED_FLAG = 'godmode.seeded.v1';
export const MAX_SAVES = 8;

interface StoredSave {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  json: string;
}

export interface SaveMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  bytes: number;
}

export interface Prefs {
  volume: number;
  muted: boolean;
  quality: QualityLevel;
  trailLength: number;
  showPerf: boolean;
  labels: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  volume: 0.5,
  muted: false,
  // 'auto' lets the adaptive controller pick the rendering tier at runtime
  // (weak hardware is detected in app.startingTier, then refined by frame time).
  quality: 'auto',
  trailLength: 0.55,
  showPerf: false,
  labels: true,
};

function readStore(): StoredSave[] {
  try {
    const raw = localStorage.getItem(SAVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const records: StoredSave[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.json === 'string'
      ) {
        records.push({
          id: item.id,
          name: item.name.slice(0, 64),
          createdAt: Number(item.createdAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now(),
          json: item.json,
        });
      }
    }
    return records;
  } catch {
    return [];
  }
}

function writeStore(records: StoredSave[]): void {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(records));
  } catch (error) {
    throw new Error(
      (error as Error).name === 'QuotaExceededError'
        ? 'Local storage is full. Delete an experiment or export to a file first.'
        : 'Could not write to local storage.',
    );
  }
}

export class SaveStore {
  private records: StoredSave[] = readStore();

  list(): SaveMeta[] {
    return this.records.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      bytes: r.json.length,
    }));
  }

  get size(): number {
    return this.records.length;
  }

  save(name: string, world: World): SaveMeta {
    const clean = name.trim().slice(0, 64) || 'Untitled experiment';
    const doc = serializeExperiment(world, clean);
    return this.addRecord(clean, doc);
  }

  addDoc(name: string, doc: ExperimentDoc): SaveMeta {
    return this.addRecord(name.slice(0, 64), doc);
  }

  private addRecord(name: string, doc: ExperimentDoc): SaveMeta {
    if (this.records.length >= MAX_SAVES) {
      throw new Error(`Archive is full (${MAX_SAVES} experiments). Delete one first.`);
    }
    const json = JSON.stringify(doc);
    const id = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const record: StoredSave = {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      json,
    };
    const next = [...this.records, record];
    writeStore(next);
    this.records = next;
    return { id, name, createdAt: record.createdAt, updatedAt: record.updatedAt, bytes: json.length };
  }

  load(id: string): ExperimentDoc {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('Experiment not found.');
    return parseExperiment(record.json);
  }

  exportJSON(id: string): { name: string; json: string } {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('Experiment not found.');
    // Re-serialise through the validator so exported files are always clean.
    const doc = parseExperiment(record.json);
    return { name: doc.name, json: JSON.stringify(doc, null, 2) };
  }

  rename(id: string, name: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;
    const clean = name.trim().slice(0, 64);
    if (!clean) return;
    record.name = clean;
    record.updatedAt = Date.now();
    try {
      const doc = parseExperiment(record.json);
      doc.name = clean;
      doc.updatedAt = record.updatedAt;
      record.json = JSON.stringify(doc);
    } catch {
      // Keep the old payload if it cannot be parsed; metadata still updates.
    }
    writeStore(this.records);
  }

  remove(id: string): void {
    const next = this.records.filter((r) => r.id !== id);
    writeStore(next);
    this.records = next;
  }

  importText(text: string): ExperimentDoc {
    const doc = parseExperiment(text);
    return doc;
  }
}

export function ensureSamples(): void {
  try {
    if (localStorage.getItem(SEED_FLAG) === '1') return;
    if (readStore().length > 0) {
      localStorage.setItem(SEED_FLAG, '1');
      return;
    }
    const store = new SaveStore();
    const plants: { scenario: string; name: string }[] = [
      { scenario: 'binary', name: 'Sample · Binary Dance' },
      { scenario: 'chaos', name: 'Sample · Total Chaos' },
    ];
    for (const plant of plants) {
      const world = createWorld(4242, 8000);
      loadScenario(world, plant.scenario, 2600);
      store.save(plant.name, world);
    }
    localStorage.setItem(SEED_FLAG, '1');
  } catch {
    // Storage unavailable or full: samples are optional.
  }
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const quality: QualityLevel =
      parsed.quality === 'cinematic' ||
      parsed.quality === 'performance' ||
      parsed.quality === 'balanced' ||
      parsed.quality === 'auto'
        ? parsed.quality
        : DEFAULT_PREFS.quality;
    return {
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_PREFS.volume,
      muted: Boolean(parsed.muted),
      quality,
      trailLength:
        typeof parsed.trailLength === 'number'
          ? Math.min(1, Math.max(0, parsed.trailLength))
          : DEFAULT_PREFS.trailLength,
      showPerf: Boolean(parsed.showPerf),
      labels: parsed.labels === undefined ? true : Boolean(parsed.labels),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are not critical.
  }
}

export function downloadJSON(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
