import type { BodyKind, CosmicEvent, QualityLevel, ToolId } from '../core/types';
import type { Objective } from '../core/objectives';
import { HORIZON_FACTOR } from '../core/world';
import { TOOLS, toolById } from '../tools';
import {
  button,
  clear,
  el,
  formatBytes,
  formatClock,
  formatDate,
  formatNumber,
  iconNode,
  provideIcons,
  sectionHead,
  slider,
  tag,
} from './dom';
import { ICONS, icon } from './icons';

export interface BodySummary {
  id: number;
  kind: BodyKind;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  influence: number;
  strength: number;
  life: number;
  maxLife: number;
  hue: number;
}

export interface SaveMetaUI {
  id: string;
  name: string;
  updatedAt: number;
  bytes: number;
  isSample: boolean;
}

export interface ToolDefaults {
  wellMass: number;
  wellInfluence: number;
  wellStrength: number;
  repelInfluence: number;
  repelStrength: number;
  holeMass: number;
  supernovaPower: number;
}

export type ToolDefaultKey = keyof ToolDefaults;

export interface UIState {
  tool: ToolId;
  selected: BodySummary | null;
  paused: boolean;
  speed: number;
  quality: QualityLevel;
  muted: boolean;
  volume: number;
  trailLength: number;
  gravity: number;
  events: CosmicEvent[];
  objectives: Objective[];
  scenarios: { id: string; name: string; blurb: string }[];
  activeScenario: string;
  saves: SaveMetaUI[];
  checkpoints: { index: number; label: string }[];
  keyframes: { at: number; label: string }[];
  keyframeIndex: number | null;
  simTime: number;
  particleCount: number;
  baseline: number;
  bodyCount: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  perfVisible: boolean;
  labelsVisible: boolean;
  toolDefaults: ToolDefaults;
  canUndo: boolean;
  canRedo: boolean;
  archiveFull: boolean;
}

export interface UIActions {
  selectTool(id: ToolId): void;
  togglePause(): void;
  setSpeed(speed: number): void;
  resetUniverse(): void;
  undo(): void;
  redo(): void;
  setQuality(quality: QualityLevel): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  setTrail(value: number): void;
  setGravity(value: number): void;
  updateSelected(patch: Partial<BodySummary>): void;
  deleteSelected(): void;
  spawnBody(kind: 'star' | 'planet'): void;
  loadScenario(id: string): void;
  focus(x: number, y: number): void;
  checkpoint(): void;
  restoreCheckpoint(index: number): void;
  rewindTo(index: number): void;
  saveExperiment(name: string): void;
  loadSave(id: string): void;
  renameSave(id: string, name: string): void;
  deleteSave(id: string): void;
  exportSave(id: string): void;
  exportCurrent(): void;
  importFile(file: File): void;
  togglePerf(): void;
  toggleLabels(): void;
  setToolDefault(key: ToolDefaultKey, value: number): void;
  clearEvents(): void;
  zoom(factor: number): void;
  hideUi(): void;
}

export interface LabelInfo {
  id: number;
  label: string;
  kind: BodyKind;
  x: number;
  y: number;
  selected: boolean;
}

type TabId = 'lab' | 'worlds' | 'events' | 'missions' | 'archive';

const TABS: { id: TabId; label: string }[] = [
  { id: 'lab', label: 'LAB' },
  { id: 'worlds', label: 'WORLDS' },
  { id: 'events', label: 'EVENTS' },
  { id: 'missions', label: 'MISSIONS' },
  { id: 'archive', label: 'ARCHIVE' },
];

const KIND_LABEL: Record<BodyKind, string> = {
  star: 'STAR',
  planet: 'PLANET',
  blackhole: 'BLACK HOLE',
  well: 'GRAVITY WELL',
  repulsor: 'REPULSOR',
};

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export class UI {
  private readonly actions: UIActions;
  private readonly hud: HTMLElement;
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly panelBody: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly scenarioEl: HTMLElement;
  private readonly matterEl: HTMLElement;
  private readonly bodiesEl: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly speedButtons = new Map<number, HTMLButtonElement>();
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly soundButton: HTMLButtonElement;
  private readonly volumeSlider: HTMLInputElement;
  private readonly perfButton: HTMLButtonElement;
  private readonly labelsButton: HTMLButtonElement;
  private readonly perfPanel: HTMLElement;
  private readonly perfFields: Record<string, HTMLElement> = {};
  private readonly rewindSlider: HTMLInputElement;
  private readonly rewindLabel: HTMLElement;
  private readonly qualitySelect: HTMLSelectElement;
  private readonly labelsLayer: HTMLElement;
  private readonly labelNodes = new Map<number, HTMLElement>();
  private readonly toasts: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly help: HTMLElement;
  private readonly importInput: HTMLInputElement;
  private readonly saveInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly panelToggle: HTMLButtonElement;
  private readonly showUiButton: HTMLButtonElement;

  private activeTab: TabId = 'lab';
  private state: UIState | null = null;
  private hintTimer: number | null = null;
  private collapsed = false;
  private panelOpen = false;
  private renaming: string | null = null;
  private lastPanelSignature = '';
  private lastPerfSignature = '';

  constructor(mount: HTMLElement, actions: UIActions) {
    provideIcons(ICONS);
    this.actions = actions;
    this.hud = el('div', 'hud');
    mount.appendChild(this.hud);

    const topbar = el('header', 'topbar');
    const brand = el('div', 'brand');
    const mark = el('span', 'brand-mark');
    mark.appendChild(el('span', 'brand-orbit'));
    brand.append(mark, el('span', 'brand-name', 'GOD MODE'), el('span', 'brand-sub', 'COSMIC SANDBOX'));

    const status = el('div', 'top-status');
    this.scenarioEl = el('span', 'scenario-name', 'PRIME FIELD');
    const matterWrap = el('span', 'readout');
    matterWrap.append(el('span', 'readout-key', 'MATTER'), (this.matterEl = el('b', '', '0')));
    const bodyWrap = el('span', 'readout');
    bodyWrap.append(el('span', 'readout-key', 'BODIES'), (this.bodiesEl = el('b', '', '0')));
    status.append(this.scenarioEl, el('span', 'hairline'), matterWrap, bodyWrap);

    const topActions = el('div', 'top-actions');
    this.undoButton = this.iconBtn('undo', 'Undo (Z)', () => this.actions.undo());
    this.redoButton = this.iconBtn('redo', 'Redo (Y)', () => this.actions.redo());
    this.qualitySelect = el('select', 'quality-select');
    for (const q of ['cinematic', 'balanced', 'performance'] as QualityLevel[]) {
      const opt = el('option', '', q[0].toUpperCase() + q.slice(1));
      opt.value = q;
      this.qualitySelect.appendChild(opt);
    }
    this.qualitySelect.addEventListener('change', () => {
      this.actions.setQuality(this.qualitySelect.value as QualityLevel);
    });
    this.soundButton = this.iconBtn('sound', 'Mute (M)', () => this.actions.setMuted(!this.state?.muted));
    this.volumeSlider = el('input', 'volume-slider');
    this.volumeSlider.type = 'range';
    this.volumeSlider.min = '0';
    this.volumeSlider.max = '1';
    this.volumeSlider.step = '0.05';
    this.volumeSlider.title = 'Master volume';
    this.volumeSlider.addEventListener('input', () =>
      this.actions.setVolume(Number(this.volumeSlider.value)),
    );
    this.perfButton = this.iconBtn('perf', 'Performance readout (P)', () => this.actions.togglePerf());
    this.labelsButton = this.iconBtn('tag', 'Toggle labels (L)', () => this.actions.toggleLabels());
    this.labelsButton.innerHTML = '';
    this.labelsButton.appendChild(icon('layers'));
    const helpBtn = this.iconBtn('help', 'Shortcuts & notes (?)', () => this.toggleHelp());
    const hideBtn = this.iconBtn('panel', 'Hide interface (H)', () => this.actions.hideUi());
    topActions.append(
      this.undoButton,
      this.redoButton,
      el('span', 'hairline'),
      this.qualitySelect,
      this.soundButton,
      this.volumeSlider,
      el('span', 'hairline'),
      this.perfButton,
      this.labelsButton,
      helpBtn,
      hideBtn,
    );
    topbar.append(brand, status, topActions);

    // --- Tool rail ---
    const rail = el('div', 'toolrail');
    const toolsWrap = el('div', 'rail-tools');
    for (const tool of TOOLS) {
      const btn = el('button', 'tool-button');
      btn.type = 'button';
      btn.title = `${tool.name} (${tool.key}) — ${tool.hint}`;
      btn.dataset.tool = tool.id;
      btn.append(icon(tool.id), el('span', 'tool-key', tool.key));
      btn.addEventListener('click', () => this.actions.selectTool(tool.id));
      toolsWrap.appendChild(btn);
      this.toolButtons.set(tool.id, btn);
    }
    const zoomWrap = el('div', 'rail-zoom');
    zoomWrap.append(
      this.iconBtn('plus', 'Zoom in', () => this.actions.zoom(0.75)),
      this.iconBtn('minus', 'Zoom out', () => this.actions.zoom(1.35)),
    );
    rail.append(toolsWrap, el('div', 'rail-rule'), zoomWrap);
    rail.title = 'Tool rail';

    // --- Right panel ---
    this.panel = el('aside', 'panel');
    const tabbar = el('nav', 'tabs');
    for (const tab of TABS) {
      const btn = el('button', 'tab-button', tab.label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.lastPanelSignature = '';
        this.renderPanel();
        this.panel.classList.add('panel-open');
        this.panelOpen = true;
      });
      tabbar.appendChild(btn);
      this.tabButtons.set(tab.id, btn);
    }
    this.panelBody = el('div', 'panel-body');
    this.panel.append(tabbar, this.panelBody);

    // --- Transport ---
    const transport = el('div', 'transport');
    this.pauseButton = el('button', 'transport-play');
    this.pauseButton.type = 'button';
    this.pauseButton.title = 'Pause / resume (Space)';
    this.pauseButton.addEventListener('click', () => this.actions.togglePause());
    const speeds = el('div', 'speed-chips');
    for (const speed of SPEEDS) {
      const chip = el('button', 'speed-chip', speed === 1 ? '1×' : `${speed}×`);
      chip.type = 'button';
      chip.title = `Simulation speed ${speed}×`;
      chip.addEventListener('click', () => this.actions.setSpeed(speed));
      speeds.appendChild(chip);
      this.speedButtons.set(speed, chip);
    }
    const clockWrap = el('div', 'clock-block');
    clockWrap.append(el('span', 'clock-label', 'SIM TIME'), (this.clockEl = el('b', 'clock-value', '00:00.0')));
    const rewindWrap = el('div', 'rewind');
    const rewindHead = el('div', 'rewind-head');
    rewindHead.append(
      el('span', 'rewind-label', 'REWIND'),
      (this.rewindLabel = el('span', 'rewind-value', 'snapshots pending')),
    );
    this.rewindSlider = el('input', 'rewind-slider');
    this.rewindSlider.type = 'range';
    this.rewindSlider.min = '0';
    this.rewindSlider.max = '0';
    this.rewindSlider.step = '1';
    this.rewindSlider.value = '0';
    this.rewindSlider.title =
      'Restores a periodic full-state snapshot. Physics between snapshots is not reversible; use pause and snapshots for controlled experiments.';
    this.rewindSlider.addEventListener('input', () =>
      this.actions.rewindTo(Number(this.rewindSlider.value)),
    );
    rewindWrap.append(rewindHead, this.rewindSlider);
    const resetBtn = el('button', 'transport-reset');
    resetBtn.type = 'button';
    resetBtn.title = 'Reset universe (R)';
    resetBtn.append(icon('reset'), el('span', '', 'RESET'));
    resetBtn.addEventListener('click', () => this.actions.resetUniverse());
    transport.append(this.pauseButton, speeds, clockWrap, rewindWrap, resetBtn);

    // --- Overlays ---
    this.labelsLayer = el('div', 'labels');
    this.toasts = el('div', 'toasts');
    this.hint = el('div', 'hint');
    this.perfPanel = el('div', 'perf-panel');
    this.buildPerfPanel();

    this.help = el('div', 'help-overlay hidden');
    this.buildHelp();

    this.panelToggle = el('button', 'panel-toggle');
    this.panelToggle.type = 'button';
    this.panelToggle.title = 'Show panels';
    this.panelToggle.append(icon('panel'));
    this.panelToggle.addEventListener('click', () => {
      this.panelOpen = !this.panelOpen;
      this.panel.classList.toggle('panel-open', this.panelOpen);
    });

    this.showUiButton = el('button', 'show-ui hidden');
    this.showUiButton.type = 'button';
    this.showUiButton.textContent = 'SHOW INTERFACE';
    this.showUiButton.addEventListener('click', () => this.setCollapsed(false));

    this.importInput = el('input', 'hidden-input');
    this.importInput.type = 'file';
    this.importInput.accept = 'application/json,.json';
    this.importInput.addEventListener('change', () => {
      const file = this.importInput.files?.[0];
      if (file) this.actions.importFile(file);
      this.importInput.value = '';
    });

    this.saveInput = el('input', 'text-input save-name');
    this.saveInput.type = 'text';
    this.saveInput.maxLength = 64;
    this.saveInput.placeholder = 'Name this universe…';
    this.saveButton = button('SAVE', {
      className: 'primary',
      onClick: () => {
        const name = this.saveInput.value.trim();
        if (!name) {
          this.flashHint('Give the experiment a name before saving.');
          this.saveInput.focus();
          return;
        }
        this.actions.saveExperiment(name);
        this.saveInput.value = '';
      },
    });

    this.hud.append(
      topbar,
      rail,
      this.panel,
      this.labelsLayer,
      transport,
      this.perfPanel,
      this.toasts,
      this.hint,
      this.panelToggle,
      this.showUiButton,
      this.help,
      this.importInput,
    );

    this.renderPanel();
    this.flashHint('Drag anywhere to bend matter · 1–7 select powers · Space pauses', 11000);
  }

  private iconBtn(iconName: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button', 'icon-button');
    btn.type = 'button';
    btn.title = title;
    btn.appendChild(icon(iconName));
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  private buildPerfPanel(): void {
    const title = el('div', 'perf-title');
    title.append(el('span', '', 'ENGINE TELEMETRY'), el('span', 'perf-live', 'LIVE'));
    this.perfPanel.appendChild(title);
    const grid = el('div', 'perf-grid');
    const fields = [
      ['fps', 'FPS'],
      ['frame', 'FRAME'],
      ['matter', 'MATTER'],
      ['bodies', 'BODIES'],
      ['draws', 'DRAW CALLS'],
      ['speed', 'SIM SPEED'],
    ] as const;
    for (const [key, label] of fields) {
      const cell = el('div', 'perf-cell');
      const value = el('b', '', '—');
      cell.append(el('span', '', label), value);
      this.perfFields[key] = value;
      grid.appendChild(cell);
    }
    this.perfPanel.appendChild(grid);
    this.perfPanel.appendChild(
      el('p', 'perf-note', 'Read directly from the running engine each frame. No synthetic values.'),
    );
  }

  private buildHelp(): void {
    const card = el('div', 'help-card');
    const head = el('div', 'help-head');
    head.append(el('h2', '', 'INSTRUMENT MANUAL'));
    const close = this.iconBtn('close', 'Close', () => this.toggleHelp());
    head.appendChild(close);
    const keys = el('dl', 'help-keys');
    const rows: [string, string][] = [
      ['1 – 7', 'Select power'],
      ['SPACE', 'Pause / resume'],
      ['+ / −', 'Simulation speed'],
      ['Z / Y', 'Undo / redo'],
      ['F', 'Focus selection'],
      ['DEL', 'Delete selection'],
      ['R', 'Reset universe'],
      ['M / P / L', 'Mute · perf · labels'],
      ['H', 'Hide interface'],
      ['WHEEL', 'Zoom · drag empty space to pan'],
    ];
    for (const [key, label] of rows) {
      keys.append(el('dt', '', key), el('dd', '', label));
    }
    const note = el('p', 'help-note');
    note.textContent =
      'Physics: softened Newtonian gravity, semi-implicit Euler, fixed 60 Hz step. Event horizons absorb matter. Rewind restores periodic snapshots — it does not reverse the simulation. This is a real-time approximation, not a general-relativity solver. All imagery and sound are generated procedurally; no NASA, ISRO, Roscosmos or ESA media is bundled.';
    card.append(head, keys, note);
    this.help.appendChild(card);
    this.help.addEventListener('click', (event) => {
      if (event.target === this.help) this.toggleHelp();
    });
  }

  toggleHelp(force?: boolean): void {
    const show = force ?? this.help.classList.contains('hidden');
    this.help.classList.toggle('hidden', !show);
  }

  sync(state: UIState): void {
    this.state = state;
    for (const [id, btn] of this.toolButtons) btn.classList.toggle('active', id === state.tool);
    for (const [speed, btn] of this.speedButtons) btn.classList.toggle('active', speed === state.speed);
    for (const [id, btn] of this.tabButtons) {
      btn.classList.toggle('active', id === this.activeTab);
      if (id === 'events') {
        if (state.events.length > 0) btn.dataset.count = String(Math.min(99, state.events.length));
        else delete btn.dataset.count;
      }
      if (id === 'missions') {
        const done = state.objectives.filter((o) => o.done).length;
        if (done > 0) btn.dataset.count = `${done}/${state.objectives.length}`;
        else delete btn.dataset.count;
      }
    }

    this.pauseButton.innerHTML = '';
    this.pauseButton.appendChild(icon(state.paused ? 'play' : 'pause'));
    this.pauseButton.classList.toggle('paused', state.paused);
    this.pauseButton.title = state.paused ? 'Resume (Space)' : 'Pause (Space)';

    this.undoButton.disabled = !state.canUndo;
    this.redoButton.disabled = !state.canRedo;
    this.soundButton.innerHTML = '';
    this.soundButton.appendChild(icon(state.muted ? 'mute' : 'sound'));
    this.soundButton.classList.toggle('on', !state.muted);
    this.qualitySelect.value = state.quality;
    if (document.activeElement !== this.volumeSlider) this.volumeSlider.value = String(state.volume);
    this.perfButton.classList.toggle('on', state.perfVisible);
    this.labelsButton.classList.toggle('on', state.labelsVisible);
    this.perfPanel.classList.toggle('visible', state.perfVisible);

    const scenario = state.scenarios.find((s) => s.id === state.activeScenario);
    this.scenarioEl.textContent = (scenario?.name ?? 'SANDBOX').toUpperCase();
    this.clockEl.textContent = formatClock(state.simTime);
    this.matterEl.textContent = formatNumber(state.particleCount);
    this.bodiesEl.textContent = String(state.bodyCount);

    const lastFrame = state.keyframes[state.keyframes.length - 1];
    this.rewindSlider.max = String(Math.max(0, state.keyframes.length - 1));
    this.rewindSlider.disabled = state.keyframes.length < 2;
    if (document.activeElement !== this.rewindSlider) {
      const index =
        state.keyframeIndex !== null && state.keyframes[state.keyframeIndex]
          ? state.keyframeIndex
          : Math.max(0, state.keyframes.length - 1);
      this.rewindSlider.value = String(index);
      const shown = state.keyframes[index] ?? lastFrame;
      this.rewindLabel.textContent = shown
        ? state.keyframeIndex !== null
          ? `restored · ${shown.label}`
          : `${state.keyframes.length} snapshot${state.keyframes.length === 1 ? '' : 's'}`
        : 'collecting…';
    }

    const perfSig = `${state.quality}|${state.perfVisible}`;
    if (perfSig !== this.lastPerfSignature) {
      this.lastPerfSignature = perfSig;
      if (state.perfVisible) this.perfPanel.classList.add('visible');
    }
    if (state.perfVisible) {
      this.perfFields.fps.textContent = state.fps > 0 ? state.fps.toFixed(0) : '—';
      this.perfFields.frame.textContent = `${state.frameMs.toFixed(1)} ms`;
      this.perfFields.matter.textContent = formatNumber(state.particleCount);
      this.perfFields.bodies.textContent = String(state.bodyCount);
      this.perfFields.draws.textContent = String(state.drawCalls);
      this.perfFields.speed.textContent = `${state.speed}×`;
    }
    this.saveButton.disabled = state.archiveFull;

    this.renderPanel();
    this.checkHint();
  }

  private panelSignature(): string {
    const s = this.state;
    if (!s) return '';
    const parts: (string | number | boolean)[] = [
      this.activeTab,
      s.selected?.id ?? 'none',
      s.selected
        ? `${s.selected.mass}|${s.selected.radius}|${s.selected.influence}|${s.selected.strength}|${s.selected.life}`
        : 'none',
      s.tool,
      s.events.length,
      s.events[0]?.id ?? 0,
      s.objectives.map((o) => `${o.id}:${o.done}:${o.progress.toFixed(2)}`).join(','),
      s.saves.map((x) => `${x.id}:${x.updatedAt}:${x.name}`).join(','),
      s.checkpoints.map((c) => c.index + c.label).join(','),
      s.keyframes.length,
      s.keyframeIndex ?? 'live',
      s.trailLength,
      s.gravity,
      s.volume,
      JSON.stringify(s.toolDefaults),
      s.archiveFull,
      s.activeScenario,
      this.renaming ?? '',
    ];
    return parts.join('|');
  }

  private renderPanel(): void {
    if (!this.state) return;
    const signature = this.panelSignature();
    if (signature === this.lastPanelSignature) return;
    this.lastPanelSignature = signature;
    const active = document.activeElement;
    if (active && this.panelBody.contains(active) && active instanceof HTMLInputElement) return;

    const scroll = this.panelBody.scrollTop;
    clear(this.panelBody);
    switch (this.activeTab) {
      case 'lab':
        this.renderLab();
        break;
      case 'worlds':
        this.renderWorlds();
        break;
      case 'events':
        this.renderEvents();
        break;
      case 'missions':
        this.renderMissions();
        break;
      case 'archive':
        this.renderArchive();
        break;
    }
    this.panelBody.scrollTop = scroll;
    for (const [id, btn] of this.tabButtons) btn.classList.toggle('active', id === this.activeTab);
  }

  private renderLab(): void {
    const s = this.state!;
    this.panelBody.append(sectionHead('FORCE LAB', s.selected ? 'SELECTED' : 'LIVE'));
    if (s.selected) {
      this.renderSelection(s.selected);
    } else {
      const tool = toolById(s.tool);
      const card = el('div', 'tool-card');
      card.append(el('div', 'tool-card-name', tool.name.toUpperCase()), el('p', 'tool-card-hint', tool.hint));
      this.panelBody.appendChild(card);
      this.renderToolDefaults(s);
    }

    this.panelBody.appendChild(sectionHead('UNIVERSE PARAMETERS'));
    const params = el('div', 'slider-group');
    params.append(
      slider({
        label: 'GRAVITY CONSTANT',
        min: 500,
        max: 6000,
        step: 50,
        value: s.gravity,
        format: (v) => v.toFixed(0),
        onInput: (v) => this.actions.setGravity(v),
        title: 'Scales every body and force source. Changes take effect immediately.',
      }),
      slider({
        label: 'TRAIL LENGTH',
        min: 0,
        max: 1,
        step: 0.05,
        value: s.trailLength,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => this.actions.setTrail(v),
        title: 'Visual motion streaks. Purely cosmetic.',
      }),
    );
    this.panelBody.appendChild(params);

    const quick = el('div', 'button-row');
    quick.append(
      button('SPAWN STAR', { onClick: () => this.actions.spawnBody('star'), className: 'ghost' }),
      button('SPAWN PLANET', { onClick: () => this.actions.spawnBody('planet'), className: 'ghost' }),
    );
    this.panelBody.append(sectionHead('MATTER'), quick);
    const info = el('div', 'kv-list');
    info.append(
      this.kv('PARTICLES', `${formatNumber(s.particleCount)} / ${formatNumber(s.baseline)}`),
      this.kv('BODIES', String(s.bodyCount)),
      this.kv('STATUS', s.paused ? 'PAUSED' : `RUNNING ${s.speed}×`),
    );
    this.panelBody.appendChild(info);
  }

  private kv(key: string, value: string): HTMLElement {
    const row = el('div', 'kv');
    row.append(el('span', 'kv-key', key), el('b', 'kv-value', value));
    return row;
  }

  private renderSelection(body: BodySummary): void {
    const head = el('div', 'object-head');
    const swatch = el('span', 'object-swatch');
    swatch.style.background = `hsl(${body.hue === 0 ? 42 : body.hue === 1 ? 193 : body.hue === 2 ? 258 : body.hue === 3 ? 220 : 12} 90% 62%)`;
    const meta = el('div', 'object-meta');
    meta.append(el('div', 'object-label', body.label), el('div', 'object-kind', `${KIND_LABEL[body.kind]} · #${body.id}`));
    head.append(swatch, meta);
    const del = this.iconBtn('trash', 'Delete selection (Del)', () => this.actions.deleteSelected());
    head.appendChild(del);
    this.panelBody.appendChild(head);

    const telemetry = el('div', 'kv-list');
    telemetry.append(
      this.kv('POSITION', `${Math.round(body.x)} , ${Math.round(body.y)}`),
      this.kv('VELOCITY', `${Math.hypot(body.vx, body.vy).toFixed(1)} u/s`),
      this.kv('MASS', formatNumber(body.mass)),
    );
    if (body.kind === 'blackhole') {
      telemetry.append(this.kv('EVENT HORIZON', `${(body.radius * HORIZON_FACTOR).toFixed(1)} u`));
    }
    if (body.life >= 0) {
      telemetry.append(this.kv('COLLAPSE IN', `${Math.max(0, body.life).toFixed(1)} s`));
    }
    this.panelBody.appendChild(telemetry);

    const group = el('div', 'slider-group');
    group.append(
      slider({
        label: 'MASS',
        min: 0,
        max: 8000,
        step: 10,
        value: body.mass,
        format: (v) => formatNumber(v),
        onInput: (v) => this.actions.updateSelected({ mass: v }),
        title: 'Gravitational mass.',
      }),
      slider({
        label: 'RADIUS',
        min: 1,
        max: 70,
        step: 0.5,
        value: body.radius,
        format: (v) => `${v.toFixed(1)} u`,
        onInput: (v) => this.actions.updateSelected({ radius: v }),
        title: 'Drawn radius; black hole event horizon is 2.1× this.',
      }),
    );
    if (body.kind === 'well' || body.kind === 'repulsor') {
      group.append(
        slider({
          label: 'INFLUENCE RADIUS',
          min: 80,
          max: 2200,
          step: 10,
          value: body.influence,
          format: (v) => `${v.toFixed(0)} u`,
          onInput: (v) => this.actions.updateSelected({ influence: v }),
          title: 'Force falls to zero at this radius.',
        }),
        slider({
          label: 'FORCE STRENGTH',
          min: 0.1,
          max: 3,
          step: 0.05,
          value: body.strength,
          format: (v) => `${v.toFixed(2)}×`,
          onInput: (v) => this.actions.updateSelected({ strength: v }),
        }),
      );
    }
    if (body.kind === 'star') {
      group.append(
        slider({
          label: 'COLLAPSE TIMER',
          min: 0,
          max: 90,
          step: 1,
          value: body.life < 0 ? 0 : body.life,
          format: (v) => (v <= 0 ? 'STABLE' : `${v.toFixed(0)} s`),
          onInput: (v) =>
            this.actions.updateSelected({ life: v <= 0 ? -1 : v, maxLife: v <= 0 ? -1 : v }),
          title: '0 = stable. Any positive value detonates the star as a supernova after that many seconds.',
        }),
      );
    }
    this.panelBody.appendChild(group);

    const actions = el('div', 'button-row');
    actions.append(
      button('FOCUS', { iconName: 'locate', className: 'ghost', onClick: () => this.actions.focus(body.x, body.y) }),
      button('DELETE', { iconName: 'trash', className: 'danger ghost', onClick: () => this.actions.deleteSelected() }),
    );
    this.panelBody.appendChild(actions);
  }

  private renderToolDefaults(s: UIState): void {
    const group = el('div', 'slider-group');
    if (s.tool === 'gravity') {
      group.append(
        slider({
          label: 'WELL MASS',
          min: 100,
          max: 3000,
          step: 50,
          value: s.toolDefaults.wellMass,
          format: (v) => formatNumber(v),
          onInput: (v) => this.actions.setToolDefault('wellMass', v),
        }),
        slider({
          label: 'INFLUENCE RADIUS',
          min: 120,
          max: 1200,
          step: 10,
          value: s.toolDefaults.wellInfluence,
          format: (v) => `${v.toFixed(0)} u`,
          onInput: (v) => this.actions.setToolDefault('wellInfluence', v),
        }),
        slider({
          label: 'STRENGTH',
          min: 0.2,
          max: 3,
          step: 0.1,
          value: s.toolDefaults.wellStrength,
          format: (v) => `${v.toFixed(1)}×`,
          onInput: (v) => this.actions.setToolDefault('wellStrength', v),
        }),
      );
      this.panelBody.appendChild(group);
    } else if (s.tool === 'repel') {
      group.append(
        slider({
          label: 'INFLUENCE RADIUS',
          min: 120,
          max: 1200,
          step: 10,
          value: s.toolDefaults.repelInfluence,
          format: (v) => `${v.toFixed(0)} u`,
          onInput: (v) => this.actions.setToolDefault('repelInfluence', v),
        }),
        slider({
          label: 'STRENGTH',
          min: 0.2,
          max: 3,
          step: 0.1,
          value: s.toolDefaults.repelStrength,
          format: (v) => `${v.toFixed(1)}×`,
          onInput: (v) => this.actions.setToolDefault('repelStrength', v),
        }),
      );
      this.panelBody.appendChild(group);
    } else if (s.tool === 'blackhole') {
      group.append(
        slider({
          label: 'SINGULARITY MASS',
          min: 800,
          max: 8000,
          step: 100,
          value: s.toolDefaults.holeMass,
          format: (v) => formatNumber(v),
          onInput: (v) => this.actions.setToolDefault('holeMass', v),
        }),
      );
      this.panelBody.appendChild(group);
    } else if (s.tool === 'supernova') {
      group.append(
        slider({
          label: 'SHOCKWAVE POWER',
          min: 0.4,
          max: 2,
          step: 0.1,
          value: s.toolDefaults.supernovaPower,
          format: (v) => `${v.toFixed(1)}×`,
          onInput: (v) => this.actions.setToolDefault('supernovaPower', v),
          title: 'Scales the shockwave radius, front speed, strength and ejecta count.',
        }),
      );
      this.panelBody.appendChild(group);
    }
  }

  private renderWorlds(): void {
    const s = this.state!;
    this.panelBody.append(sectionHead('SCENARIOS', `${s.scenarios.length} FIELDS`));
    this.panelBody.appendChild(
      el(
        'p',
        'panel-note',
        'Each world is a reproducible starting state. Loading one clears undo history but never reloads the page.',
      ),
    );
    for (const scenario of s.scenarios) {
      const row = el('div', `scenario-row ${scenario.id === s.activeScenario ? 'active' : ''}`);
      const text = el('div', 'scenario-text');
      text.append(el('div', 'scenario-name', scenario.name.toUpperCase()), el('p', 'scenario-blurb', scenario.blurb));
      const load = button(scenario.id === s.activeScenario ? 'RELOAD' : 'LOAD', {
        className: 'ghost small',
        onClick: () => this.actions.loadScenario(scenario.id),
      });
      row.append(text, load);
      this.panelBody.appendChild(row);
    }
  }

  private renderEvents(): void {
    const s = this.state!;
    const head = sectionHead('COSMIC EVENTS', `${s.events.length} LOGGED`);
    const clearBtn = button('CLEAR', {
      className: 'ghost small',
      onClick: () => this.actions.clearEvents(),
    });
    head.appendChild(clearBtn);
    this.panelBody.appendChild(head);
    if (s.events.length === 0) {
      this.panelBody.appendChild(
        el('p', 'empty-state', 'No events yet. Detonate a star, open a singularity, or drive two masses together.'),
      );
      return;
    }
    const list = el('div', 'event-list');
    for (const event of s.events.slice(0, 30)) {
      const row = el('button', `event-row kind-${event.kind}`);
      row.type = 'button';
      row.title = 'Focus this location';
      const top = el('div', 'event-top');
      top.append(tag(event.kind.toUpperCase(), 'tiny'), el('span', 'event-time', formatClock(event.at)));
      row.append(top, el('div', 'event-text', event.text));
      row.append(el('span', 'event-locate', 'LOCATE'));
      row.addEventListener('click', () => this.actions.focus(event.x, event.y));
      list.appendChild(row);
    }
    this.panelBody.appendChild(list);
  }

  private renderMissions(): void {
    const s = this.state!;
    const done = s.objectives.filter((o) => o.done).length;
    this.panelBody.append(sectionHead('DISCOVERIES', `${done} / ${s.objectives.length}`));
    this.panelBody.appendChild(
      el('p', 'panel-note', 'Optional experiments, evaluated from live simulation data. Nothing is rewarded but the result.'),
    );
    for (const objective of s.objectives) {
      const row = el('div', `mission ${objective.done ? 'done' : ''}`);
      const top = el('div', 'mission-top');
      top.append(el('span', 'mission-title', objective.title), el('span', 'mission-pct', `${Math.round(objective.progress * 100)}%`));
      const bar = el('div', 'mission-bar');
      const fill = el('span', 'mission-fill');
      fill.style.width = `${Math.min(100, objective.progress * 100)}%`;
      bar.appendChild(fill);
      row.append(top, bar, el('p', 'mission-hint', objective.hint));
      this.panelBody.appendChild(row);
    }
  }

  private renderArchive(): void {
    const s = this.state!;
    this.panelBody.append(sectionHead('ARCHIVE', `${s.saves.length} SAVED`));
    const saveRow = el('div', 'save-row');
    saveRow.append(this.saveInput, this.saveButton);
    this.panelBody.appendChild(saveRow);
    this.panelBody.appendChild(
      el('p', 'panel-note', 'Stored locally in this browser. JSON export contains the full universe state.'),
    );

    if (s.saves.length === 0) {
      this.panelBody.appendChild(el('p', 'empty-state', 'No saved experiments yet.'));
    } else {
      const list = el('div', 'save-list');
      for (const save of s.saves) {
        const row = el('div', 'save-item');
        const info = el('div', 'save-info');
        if (this.renaming === save.id) {
          const input = el('input', 'text-input inline-rename');
          input.value = save.name;
          input.maxLength = 64;
          const commit = (): void => {
            this.renaming = null;
            this.lastPanelSignature = '';
            this.actions.renameSave(save.id, input.value);
          };
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              this.renaming = null;
              this.lastPanelSignature = '';
              this.renderPanel();
            }
            event.stopPropagation();
          });
          input.addEventListener('blur', commit);
          info.appendChild(input);
          window.setTimeout(() => input.focus(), 0);
        } else {
          const name = el('div', 'save-name', save.name);
          if (save.isSample) name.appendChild(tag('SAMPLE', 'tiny'));
          info.append(
            name,
            el('div', 'save-meta', `${formatDate(save.updatedAt)} · ${formatBytes(save.bytes)}`),
          );
        }
        const ops = el('div', 'save-ops');
        ops.append(
          button('LOAD', { className: 'ghost small', onClick: () => this.actions.loadSave(save.id) }),
          this.iconBtn('edit', 'Rename', () => {
            this.renaming = save.id;
            this.lastPanelSignature = '';
            this.renderPanel();
          }),
          this.iconBtn('download', 'Export JSON', () => this.actions.exportSave(save.id)),
          this.iconBtn('trash', 'Delete', () => this.actions.deleteSave(save.id)),
        );
        row.append(info, ops);
        list.appendChild(row);
      }
      this.panelBody.appendChild(list);
    }

    const transfer = el('div', 'button-row');
    transfer.append(
      button('EXPORT CURRENT', { iconName: 'download', className: 'ghost', onClick: () => this.actions.exportCurrent() }),
      button('IMPORT JSON', {
        iconName: 'upload',
        className: 'ghost',
        onClick: () => this.importInput.click(),
      }),
    );
    this.panelBody.append(sectionHead('TRANSFER', 'JSON'), transfer);

    const checkpointHead = sectionHead('CHECKPOINTS', `${s.checkpoints.length}`);
    checkpointHead.appendChild(
      button('CAPTURE', { className: 'ghost small', onClick: () => this.actions.checkpoint() }),
    );
    this.panelBody.appendChild(checkpointHead);
    this.panelBody.appendChild(
      el('p', 'panel-note', 'Checkpoints live in memory for this session. Save an experiment to keep it across reloads.'),
    );
    if (s.checkpoints.length === 0) {
      this.panelBody.appendChild(el('p', 'empty-state', 'No checkpoints captured.'));
    } else {
      const list = el('div', 'checkpoint-list');
      for (const cp of [...s.checkpoints].reverse()) {
        const row = el('div', 'checkpoint-item');
        row.append(el('span', '', cp.label));
        row.append(
          button('RESTORE', { className: 'ghost small', onClick: () => this.actions.restoreCheckpoint(cp.index) }),
        );
        list.appendChild(row);
      }
      this.panelBody.appendChild(list);
    }
  }

  toast(message: string, variant: 'info' | 'warn' | 'success' = 'info'): void {
    const node = el('div', `toast ${variant}`);
    node.textContent = message;
    this.toasts.appendChild(node);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
    window.setTimeout(() => {
      node.classList.add('leaving');
      window.setTimeout(() => node.remove(), 320);
    }, 4200);
  }

  flashHint(text: string, duration = 5200): void {
    this.hint.textContent = text;
    this.hint.classList.add('visible');
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hint.classList.remove('visible');
      this.hintTimer = null;
    }, duration);
  }

  private checkHint(): void {
    const s = this.state;
    if (!s) return;
    if (this.hintTimer === null && s.particleCount === 0) {
      this.flashHint('The universe is empty. Paint matter or spawn a star.');
    }
  }

  updateLabels(labels: LabelInfo[], visible: boolean): void {
    if (!visible) {
      for (const node of this.labelNodes.values()) node.style.display = 'none';
      return;
    }
    const keep = new Set<number>();
    for (const label of labels) {
      keep.add(label.id);
      let node = this.labelNodes.get(label.id);
      if (!node) {
        node = el('div', 'body-label');
        const dot = el('span', 'label-dot');
        const name = el('span', 'label-name');
        const meta = el('span', 'label-meta');
        node.append(dot, name, meta);
        this.labelsLayer.appendChild(node);
        this.labelNodes.set(label.id, node);
      }
      node.classList.toggle('selected', label.selected);
      node.style.display = 'flex';
      node.style.transform = `translate(-50%, -150%) translate(${label.x.toFixed(1)}px, ${label.y.toFixed(1)}px)`;
      const name = node.querySelector('.label-name') as HTMLElement;
      const meta = node.querySelector('.label-meta') as HTMLElement;
      if (name.textContent !== label.label) name.textContent = label.label;
      if (meta.textContent !== KIND_LABEL[label.kind]) meta.textContent = KIND_LABEL[label.kind];
    }
    for (const [id, node] of this.labelNodes) {
      if (!keep.has(id)) {
        node.remove();
        this.labelNodes.delete(id);
      }
    }
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.hud.classList.toggle('collapsed', collapsed);
    this.showUiButton.classList.toggle('hidden', !collapsed);
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.classList.toggle('panel-open', open);
  }

  /** Brings the Force Lab forward when the player selects something. */
  showLab(): void {
    if (this.activeTab === 'lab') return;
    this.activeTab = 'lab';
    this.lastPanelSignature = '';
    this.renderPanel();
  }

  get activeTabId(): TabId {
    return this.activeTab;
  }

  scrollPanelToTop(): void {
    this.panelBody.scrollTop = 0;
  }

  dispose(): void {
    this.hud.remove();
  }

  /** Forces the next sync to rebuild the panel (used after external data edits). */
  invalidatePanel(): void {
    this.lastPanelSignature = '';
  }

  iconFor(name: string): HTMLSpanElement {
    return iconNode(name);
  }
}
