import { SimClock } from './core/clock';
import { EventLog } from './core/events';
import { HistoryStack, Timeline, captureSnapshot, restoreSnapshot, type Snapshot } from './core/history';
import { ObjectiveTracker } from './core/objectives';
import { addParticle } from './core/particles';
import { circularOrbitSpeed, stepWorld, type StepHooks } from './core/physics';
import { applyExperiment, experimentToJSON, serializeExperiment } from './core/serialize';
import { findScenario, loadScenario, SCENARIOS } from './core/scenarios';
import { stepQuality } from './core/types';
import type { Body, BodyKind, QualityLevel, RenderQuality, ToolId, World } from './core/types';
import {
  addBody,
  createWorld,
  detonateAt,
  findBody,
  forceMass,
  HORIZON_FACTOR,
  PALETTE,
  removeBody,
} from './core/world';
import { Interaction } from './input/interaction';
import { CameraRig } from './render/camera';
import { UniverseRenderer, type ToolPreview } from './render/renderer';
import { AudioEngine } from './audio/audio';
import { AdaptiveQuality, PerfMonitor, type PerfSnapshot } from './perf';
import { formatClock, formatNumber } from './ui/dom';
import {
  UI,
  type BodySummary,
  type LabelInfo,
  type ToolDefaultKey,
  type ToolDefaults,
  type UIActions,
  type UIState,
} from './ui/ui';
import type { InteractionHost } from './input/interaction';
import { TOOLS, toolById } from './tools';
import {
  downloadJSON,
  ensureSamples,
  loadPrefs,
  MAX_SAVES,
  savePrefs,
  SaveStore,
  type Prefs,
} from './storage';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const SCENARIO_DISTANCE: Record<string, number> = {
  prime: 3400,
  binary: 3100,
  singularity: 2900,
  collapse: 2900,
  slingshot: 3400,
  chaos: 4400,
};

interface Checkpoint {
  index: number;
  label: string;
  snapshot: Snapshot;
}

export class App implements UIActions, InteractionHost {
  private readonly world: World;
  private readonly renderer: UniverseRenderer;
  private readonly camera: CameraRig;
  private readonly clock = new SimClock();
  private readonly perf = new PerfMonitor();
  private readonly audio = new AudioEngine();
  private readonly events = new EventLog();
  private readonly objectives = new ObjectiveTracker();
  private readonly history = new HistoryStack();
  private readonly timeline = new Timeline();
  private readonly store: SaveStore;
  private readonly interaction: Interaction;
  private stepHooks: StepHooks;

  private ui: UI | null = null;
  private prefs: Prefs;
  /** User preference; 'auto' lets the adaptive controller pick the tier. */
  private quality: QualityLevel;
  /** Concrete tier currently handed to the renderer (never 'auto'). */
  private effectiveQuality: RenderQuality;
  private readonly adaptive = new AdaptiveQuality();
  private tool: ToolId = 'gravity';
  private selectedId: number | null = null;
  private hoveredId: number | null = null;
  private preview: ToolPreview | null = null;
  private labelsVisible: boolean;
  private perfVisible: boolean;
  private activeScenario = 'prime';
  private activeKeyframe: number | null = null;
  private checkpoints: Checkpoint[] = [];
  private toolDefaults: ToolDefaults = {
    wellMass: 700,
    wellInfluence: 470,
    wellStrength: 1,
    repelInfluence: 430,
    repelStrength: 1.2,
    holeMass: 2800,
    supernovaPower: 1,
  };

  private reducedMotion = false;
  private visualTime = 0;
  private lastFrame = 0;
  private lastSync = 0;
  private lastAbsorbSound = 0;
  private lastSliderRecord = 0;
  private qualityHinted = false;

  constructor(private readonly canvas: HTMLCanvasElement, mount: HTMLElement) {
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.prefs = loadPrefs();
    this.quality = this.prefs.quality;
    this.effectiveQuality = this.quality === 'auto' ? startingTier() : this.quality;
    this.labelsVisible = this.prefs.labels;
    this.perfVisible = this.prefs.showPerf;
    ensureSamples();
    this.store = new SaveStore();

    this.world = createWorld(20_260_925);
    this.world.params.trailLength = this.trailSetting();
    this.renderer = new UniverseRenderer(canvas);
    this.renderer.setQuality(this.effectiveQuality);
    this.camera = new CameraRig(this.renderer.camera);
    this.resize();

    this.audio.setVolume(this.prefs.volume);
    this.audio.setMuted(this.prefs.muted);

    this.stepHooks = {
      onMerge: (survivor, consumed) => {
        this.events.push(
          'merge',
          `${consumed.label} merged into ${survivor.label}`,
          survivor.x,
          survivor.y,
          this.world.time,
          `merge-${survivor.id}`,
          1.2,
        );
        if (survivor.kind === 'blackhole') this.playAbsorb();
        else this.audio.merge();
      },
      onBlackHoleAbsorb: (hole, count) => {
        this.events.push(
          'absorb',
          `${hole.label} consumed ${count} particle${count === 1 ? '' : 's'}`,
          hole.x,
          hole.y,
          this.world.time,
          `absorb-${hole.id}`,
          3,
        );
        this.playAbsorb();
      },
      onSupernova: (star) => {
        this.events.push(
          'supernova',
          `${star.label} collapsed — shockwave released`,
          star.x,
          star.y,
          this.world.time,
        );
        this.audio.supernova();
        this.renderer.flash(0.45);
        this.ui?.flashHint('Shockwave crossing the field — watch the matter react.', 6000);
      },
      onSlingshot: (_x, _y, speed) => {
        this.audio.slingshot(speed);
      },
    };

    this.buildScenario('prime', false);
    this.ui = new UI(mount, this);
    this.interaction = new Interaction(canvas, this);
    this.events.onChange = () => this.ui?.invalidatePanel();
    this.installListeners();
    this.canvas.style.cursor = toolById(this.tool).cursor;
    this.syncUi();
  }

  start(): void {
    this.lastFrame = performance.now();
    this.lastSync = 0;
    this.ui?.setPanelOpen(window.innerWidth >= 980);
    // Read-only diagnostics handle used by the smoke test and for debugging.
    (window as unknown as { __GODMODE__?: App }).__GODMODE__ = this;
    requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.interaction.dispose();
    this.ui?.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- lifecycle

  private resize(): void {
    const width = Math.max(320, window.innerWidth);
    const height = Math.max(320, window.innerHeight);
    this.renderer.resize(width, height);
    this.camera.setViewport(height);
  }

  private installListeners(): void {
    window.addEventListener('resize', () => {
      this.resize();
      this.syncUi();
    });
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = performance.now();
    });
    this.renderer.onContextLost = () => {
      this.clock.paused = true;
      this.ui?.toast('Graphics context lost — the simulation is paused.', 'warn');
      this.syncUi();
    };
    this.renderer.onContextRestored = () => {
      this.renderer.refreshBodies();
      this.ui?.toast('Graphics context restored.', 'success');
      this.syncUi();
    };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    this.audio.unlock();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7': {
        const tool = TOOLS[Number(event.key) - 1];
        if (tool) this.selectTool(tool.id);
        break;
      }
      case ' ':
        event.preventDefault();
        this.togglePause();
        break;
      case '+':
      case '=':
        this.stepSpeed(1);
        break;
      case '-':
      case '_':
        this.stepSpeed(-1);
        break;
      case 'z':
      case 'Z':
        this.undo();
        break;
      case 'y':
      case 'Y':
        this.redo();
        break;
      case 'f':
      case 'F':
        this.focusSelected();
        break;
      case 'r':
      case 'R':
        this.resetUniverse();
        break;
      case 'm':
      case 'M':
        this.setMuted(!this.audio.muted);
        break;
      case 'p':
      case 'P':
        this.togglePerf();
        break;
      case 'l':
      case 'L':
        this.toggleLabels();
        break;
      case 'h':
      case 'H':
        this.hideUi();
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        this.deleteSelected();
        break;
      case 'Escape':
        this.ui?.toggleHelp(false);
        break;
      case '?':
        this.ui?.toggleHelp();
        break;
      default:
        break;
    }
  };

  private stepSpeed(direction: number): void {
    const index = SPEEDS.indexOf(this.clock.speed);
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
    this.setSpeed(next);
  }

  private frame = (nowMs: number): void => {
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastFrame) / 1000));
    this.lastFrame = nowMs;
    this.perf.update(dt);
    this.visualTime += dt;

    const physicsStart = performance.now();
    const steps = this.clock.advance(dt, this.simulationStep);
    const physicsMs = performance.now() - physicsStart;
    if (steps > 0 && this.activeKeyframe !== null) this.activeKeyframe = null;

    this.camera.update(dt);
    this.timeline.maybeCapture(this.world);

    const renderStart = performance.now();
    this.renderer.update(this.world, {
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      preview: this.preview,
      time: this.reducedMotion ? 0 : this.visualTime,
      trailLength: this.world.params.trailLength,
    });
    this.renderer.render();
    this.perf.recordSections(physicsMs, performance.now() - renderStart);

    // Adaptive tier control (rendering-only; never touches world state).
    if (this.quality === 'auto') {
      const step = this.adaptive.nextFrame(dt * 1000, nowMs);
      if (step) this.stepEffectiveQuality(step === 'up' ? 1 : -1);
    }

    if (nowMs - this.lastSync > 110) {
      this.lastSync = nowMs;
      this.syncUi();
      this.autoQualityHint();
    }
    requestAnimationFrame(this.frame);
  };

  private simulationStep = (dt: number): void => {
    stepWorld(this.world, dt, this.stepHooks);
    const completed = this.objectives.evaluate(this.world, dt);
    for (const objective of completed) {
      this.events.push(
        'discovery',
        `Discovery — ${objective.title}`,
        this.camera.targetX,
        this.camera.targetY,
        this.world.time,
      );
      this.audio.discovery();
      this.ui?.toast(`Discovery: ${objective.title}`, 'success');
      this.ui?.flashHint(objective.hint, 7000);
    }
  };

  private autoQualityHint(): void {
    if (this.quality === 'auto') return; // the controller self-adjusts; no toast needed
    if (this.qualityHinted || this.perf.fps === 0) return;
    if (this.perf.fps < 42 && this.quality !== 'performance' && this.world.time > 6) {
      this.qualityHinted = true;
      this.ui?.toast('Frame rate is limited. Try PERFORMANCE (or AUTO) in the quality menu.', 'warn');
    }
  }

  private playAbsorb(): void {
    if (this.visualTime - this.lastAbsorbSound > 0.55) {
      this.lastAbsorbSound = this.visualTime;
      this.audio.absorb();
    }
  }

  // ------------------------------------------------------------------ scenario

  private targetParticles(): number {
    // Simulation density is quality-independent: quality is rendering-only,
    // so the same universe evolves regardless of tier (see DECISIONS.md D5/D6).
    return 7800;
  }

  private trailSetting(): number {
    return this.reducedMotion ? Math.min(0.18, this.prefs.trailLength) : this.prefs.trailLength;
  }

  private scenarioDistance(id: string): number {
    return SCENARIO_DISTANCE[id] ?? 3300;
  }

  private buildScenario(id: string, keepHistory: boolean): void {
    const scenario = findScenario(id);
    if (keepHistory) this.history.record('Reset universe', this.world);
    this.activeScenario = id;
    loadScenario(this.world, id, this.targetParticles());
    this.world.params.trailLength = this.trailSetting();
    this.world.params.speed = this.clock.speed;
    this.renderer.refreshBodies();
    this.selectedId = null;
    this.hoveredId = null;
    this.preview = null;
    this.clock.reset();
    this.clock.paused = false;
    this.timeline.clear();
    this.timeline.maybeCapture(this.world, true);
    this.objectives.reset();
    this.activeKeyframe = null;
    if (!keepHistory) this.history.clear();
    this.events.clear();
    this.events.push(
      'reset',
      `${scenario.name.toUpperCase()} online · ${formatNumber(this.world.particles.count)} particles`,
      0,
      0,
      0,
    );
    this.camera.snap(0, 0, this.scenarioDistance(id));
    this.syncUi();
  }

  // -------------------------------------------------------------------- tools

  selectTool(id: ToolId): void {
    this.tool = id;
    this.canvas.style.cursor = toolById(id).cursor;
    this.preview = null;
    this.audio.tick();
    this.ui?.flashHint(toolById(id).hint, 6000);
    this.syncUi();
  }

  zoom(factor: number): void {
    this.camera.zoomBy(factor);
  }

  focus(x: number, y: number): void {
    this.camera.focus(x, y, Math.min(this.camera.distance, 2400));
  }

  private focusSelected(): void {
    const body = findBody(this.world, this.selectedId);
    if (body) this.camera.focus(body.x, body.y, Math.min(this.camera.distance, 2200));
  }

  // ------------------------------------------------------- InteractionHost API

  getWorld(): World {
    return this.world;
  }

  getTool(): ToolId {
    return this.tool;
  }

  selected(): number | null {
    return this.selectedId;
  }

  getRenderer(): UniverseRenderer {
    return this.renderer;
  }

  getCamera(): CameraRig {
    return this.camera;
  }

  previewRadius(tool: ToolId): number {
    switch (tool) {
      case 'gravity':
        return this.toolDefaults.wellInfluence;
      case 'repel':
        return this.toolDefaults.repelInfluence;
      case 'blackhole':
        return 120;
      case 'supernova':
        return 260 * this.toolDefaults.supernovaPower;
      case 'paint':
        return 46;
      case 'orbit':
        return 260;
      default:
        return 0;
    }
  }

  select(id: number | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    if (id !== null) {
      this.audio.select();
      this.ui?.showLab();
    } else {
      this.audio.deselect();
    }
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  hover(id: number | null): void {
    this.hoveredId = id;
    if (this.tool === 'observe') {
      this.canvas.style.cursor = id !== null ? 'grab' : 'default';
    }
  }

  beginGesture(label: string): void {
    this.audio.unlock();
    this.history.record(label, this.world);
  }

  placeSource(tool: ToolId, x: number, y: number): number | null {
    let body: Body | null = null;
    if (tool === 'gravity') {
      body = addBody(this.world, 'well', x, y, {
        mass: this.toolDefaults.wellMass,
        influence: this.toolDefaults.wellInfluence,
        strength: this.toolDefaults.wellStrength,
      });
      this.audio.place();
    } else if (tool === 'repel') {
      body = addBody(this.world, 'repulsor', x, y, {
        mass: 0,
        influence: this.toolDefaults.repelInfluence,
        strength: this.toolDefaults.repelStrength,
      });
      this.audio.place();
    } else if (tool === 'blackhole') {
      body = addBody(this.world, 'blackhole', x, y, {
        mass: this.toolDefaults.holeMass,
        radius: Math.max(11, Math.min(26, 7 + this.toolDefaults.holeMass / 500)),
      });
      this.audio.blackhole();
      this.events.push(
        'blackhole',
        `${body.label} opened — horizon ${(body.radius * HORIZON_FACTOR).toFixed(0)} u`,
        x,
        y,
        this.world.time,
      );
    }
    if (!body) return null;
    return body.id;
  }

  moveBody(id: number, x: number, y: number): void {
    const body = findBody(this.world, id);
    if (!body) return;
    body.x = x;
    body.y = y;
  }

  placeOrbit(x: number, y: number): number | null {
    const planet = addBody(this.world, 'planet', x, y, {
      mass: 45,
      radius: 6,
      hue: PALETTE.cyan,
    });
    this.audio.place();
    const anchor = this.nearestAnchor(x, y, planet.id);
    if (!anchor) {
      this.ui?.flashHint('No anchor mass nearby — spawn a star or gravity well first.');
      return planet.id;
    }
    this.orbitVelocityAround(planet, anchor);
    return planet.id;
  }

  updateOrbit(id: number, x: number, y: number): void {
    const body = findBody(this.world, id);
    if (!body) return;
    body.x = x;
    body.y = y;
    const anchor = this.nearestAnchor(x, y, id);
    if (anchor) this.orbitVelocityAround(body, anchor);
  }

  private nearestAnchor(x: number, y: number, excludeId?: number): Body | null {
    let best: Body | null = null;
    let bestDistance = Infinity;
    for (const body of this.world.bodies) {
      if (body.id === excludeId) continue;
      if (body.kind === 'planet' || body.kind === 'repulsor') continue;
      if (forceMass(body) <= 0) continue;
      const d = Math.hypot(body.x - x, body.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = body;
      }
    }
    return best;
  }

  private orbitVelocityAround(satellite: Body, anchor: Body): void {
    const dx = satellite.x - anchor.x;
    const dy = satellite.y - anchor.y;
    const radius = Math.hypot(dx, dy);
    if (radius < anchor.radius * 1.4 || radius < 4) {
      satellite.vx = 0;
      satellite.vy = 0;
      return;
    }
    const speed = circularOrbitSpeed(Math.abs(forceMass(anchor)), radius, this.world.params.gravity);
    satellite.vx = (-dy / radius) * speed + anchor.vx;
    satellite.vy = (dx / radius) * speed + anchor.vy;
  }

  detonate(x: number, y: number): void {
    const power = this.toolDefaults.supernovaPower;
    detonateAt(this.world, x, y, { power });
    this.events.push(
      'supernova',
      `Supernova detonated at ${Math.round(x)} , ${Math.round(y)}`,
      x,
      y,
      this.world.time,
    );
    this.audio.supernova();
    this.renderer.flash(0.3 + power * 0.16);
    this.ui?.flashHint('The shockwave accelerates every particle it crosses.', 6000);
  }

  paint(x: number, y: number, fromX: number, fromY: number): void {
    const distance = Math.hypot(x - fromX, y - fromY);
    const count = Math.max(2, Math.min(26, Math.round(distance / 5) + 2));
    const rng = this.world.rng;
    const ux = distance > 0.001 ? (x - fromX) / distance : 0;
    const uy = distance > 0.001 ? (y - fromY) / distance : 0;
    const speed = Math.min(240, distance * 6);
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const px = fromX + (x - fromX) * t;
      const py = fromY + (y - fromY) * t;
      const spread = rng.range(-1, 1) * 26;
      const angle = rng.range(0, Math.PI * 2);
      const roll = rng.next();
      const pal =
        roll < 0.42 ? PALETTE.amber : roll < 0.7 ? PALETTE.white : roll < 0.9 ? PALETTE.cyan : PALETTE.violet;
      addParticle(this.world.particles, {
        x: px + rng.normal(3),
        y: py + rng.normal(3),
        z: rng.range(-30, 30),
        vx: ux * speed + Math.cos(angle) * spread,
        vy: uy * speed + Math.sin(angle) * spread,
        life: rng.range(14, 40),
        size: rng.range(2.2, 4.4),
        pal,
        seed: rng.next(),
        type: 1,
      });
    }
    this.world.stats.emitted += count;
  }

  onGestureStart(): void {
    this.audio.unlock();
  }

  setPreview(preview: ToolPreview | null): void {
    this.preview = preview;
  }

  // -------------------------------------------------------------- UI actions

  togglePause(): void {
    this.clock.paused = !this.clock.paused;
    this.clock.reset();
    if (!this.clock.paused) this.activeKeyframe = null;
    this.syncUi();
  }

  setSpeed(speed: number): void {
    this.clock.speed = speed;
    this.world.params.speed = speed;
    this.activeKeyframe = null;
    this.syncUi();
  }

  resetUniverse(): void {
    const id = this.activeScenario === 'custom' ? 'prime' : this.activeScenario;
    this.buildScenario(id, true);
    this.audio.rewind();
    this.ui?.toast('Universe reset — undo restores the previous state.', 'info');
  }

  undo(): void {
    const label = this.history.undo(this.world);
    if (!label) {
      this.ui?.toast('Nothing to undo.', 'info');
      return;
    }
    this.activeKeyframe = null;
    this.postRestore();
    this.audio.rewind();
    this.ui?.toast(`Undo · ${label}`, 'info');
  }

  redo(): void {
    const label = this.history.redo(this.world);
    if (!label) {
      this.ui?.toast('Nothing to redo.', 'info');
      return;
    }
    this.activeKeyframe = null;
    this.postRestore();
    this.audio.rewind();
    this.ui?.toast(`Redo · ${label}`, 'info');
  }

  deleteSelected(): void {
    if (this.selectedId === null) return;
    const body = findBody(this.world, this.selectedId);
    if (!body) return;
    this.history.record(`Delete ${body.label}`, this.world);
    removeBody(this.world, body.id);
    this.selectedId = null;
    this.preview = null;
    this.audio.deselect();
    this.ui?.toast(`${body.label} removed`, 'info');
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  spawnBody(kind: 'star' | 'planet'): void {
    const { x, y } = this.findClearSpot(kind === 'star' ? 240 : 160);
    this.history.record(`Spawn ${kind}`, this.world);
    const body =
      kind === 'star'
        ? addBody(this.world, 'star', x, y, { mass: 1200, radius: 28, hue: PALETTE.amber })
        : addBody(this.world, 'planet', x, y, { mass: 45, radius: 6, hue: PALETTE.cyan });
    this.selectedId = body.id;
    this.audio.place();
    this.ui?.toast(`${body.label} materialised`, 'success');
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  private findClearSpot(minDistance: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 28; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = minDistance + Math.random() * 320;
      const x = this.camera.targetX + Math.cos(angle) * distance;
      const y = this.camera.targetY + Math.sin(angle) * distance;
      const clear = this.world.bodies.every(
        (body) => Math.hypot(body.x - x, body.y - y) > body.radius + minDistance * 0.55,
      );
      if (clear) return { x, y };
    }
    return { x: this.camera.targetX + minDistance, y: this.camera.targetY + minDistance * 0.6 };
  }

  updateSelected(patch: Partial<BodySummary>): void {
    const body = findBody(this.world, this.selectedId);
    if (!body) return;
    const before = `${body.mass}|${body.radius}|${body.influence}|${body.strength}|${body.life}`;
    if (patch.mass !== undefined) body.mass = clamp(patch.mass, 0, 200_000);
    if (patch.radius !== undefined) body.radius = clamp(patch.radius, 0.6, 400);
    if (patch.influence !== undefined) body.influence = clamp(patch.influence, 0, 6000);
    if (patch.strength !== undefined) body.strength = clamp(patch.strength, -10, 10);
    if (patch.life !== undefined) {
      body.life = patch.life;
      body.maxLife = patch.maxLife ?? (patch.life > 0 ? patch.life : -1);
    }
    if (body.kind === 'well' || body.kind === 'repulsor') {
      body.influence = Math.max(body.influence, body.radius * 3);
    }
    const after = `${body.mass}|${body.radius}|${body.influence}|${body.strength}|${body.life}`;
    if (before === after) return;
    const now = Date.now();
    if (now - this.lastSliderRecord > 900) {
      this.history.record(`Adjust ${body.label}`, this.world);
      this.lastSliderRecord = now;
    }
    this.syncUi();
  }

  setGravity(value: number): void {
    this.world.params.gravity = clamp(value, 100, 20_000);
    this.syncUi();
  }

  setTrail(value: number): void {
    this.world.params.trailLength = clamp(value, 0, 1);
    this.prefs.trailLength = this.world.params.trailLength;
    this.persistPrefs();
    this.syncUi();
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    this.prefs.quality = quality;
    this.persistPrefs();
    if (quality === 'auto') {
      // Re-baseline the controller; it climbs or drops from hardware reality.
      this.adaptive.reset();
      this.effectiveQuality = startingTier();
    } else {
      this.effectiveQuality = quality;
    }
    this.applyEffectiveQuality();
    this.ui?.toast(
      `Quality: ${quality}${quality === 'auto' ? ` (now ${this.effectiveQuality})` : ''}`,
      'info',
    );
    this.syncUi();
  }

  /** Moves the effective tier one rung (adaptive controller callback). */
  private stepEffectiveQuality(direction: 1 | -1): void {
    const next = stepQuality(this.effectiveQuality, direction);
    if (!next || next === this.effectiveQuality) return;
    this.effectiveQuality = next;
    this.applyEffectiveQuality();
    this.ui?.toast(`Auto quality → ${next}`, 'info');
  }

  private applyEffectiveQuality(): void {
    // Rendering-only: the particle field and physics state are never touched
    // here, so switching tiers cannot alter simulation results.
    this.renderer.setQuality(this.effectiveQuality);
    this.resize();
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
    this.prefs.muted = muted;
    this.persistPrefs();
    this.syncUi();
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
    this.prefs.volume = this.audio.volume;
    this.persistPrefs();
    this.syncUi();
  }

  togglePerf(): void {
    this.perfVisible = !this.perfVisible;
    this.prefs.showPerf = this.perfVisible;
    this.persistPrefs();
    this.syncUi();
  }

  toggleLabels(): void {
    this.labelsVisible = !this.labelsVisible;
    this.prefs.labels = this.labelsVisible;
    this.persistPrefs();
    this.syncUi();
  }

  hideUi(): void {
    if (!this.ui) return;
    this.ui.setCollapsed(!this.ui.isCollapsed);
  }

  setToolDefault(key: ToolDefaultKey, value: number): void {
    this.toolDefaults = { ...this.toolDefaults, [key]: clamp(value, 0, 20_000) };
    this.syncUi();
  }

  clearEvents(): void {
    this.events.clear();
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  loadScenario(id: string): void {
    this.buildScenario(id, false);
    this.audio.rewind();
    this.ui?.toast(`${findScenario(id).name} loaded`, 'success');
  }

  checkpoint(): void {
    const label = `T+${formatClock(this.world.time)}`;
    this.checkpoints.push({ index: this.checkpoints.length, label, snapshot: captureSnapshot(this.world, label) });
    if (this.checkpoints.length > 6) this.checkpoints.shift();
    this.checkpoints.forEach((c, i) => (c.index = i));
    this.ui?.toast(`Checkpoint captured · ${label}`, 'success');
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  restoreCheckpoint(index: number): void {
    const checkpoint = this.checkpoints.find((c) => c.index === index);
    if (!checkpoint) return;
    restoreSnapshot(this.world, checkpoint.snapshot);
    this.clock.paused = true;
    this.clock.reset();
    this.activeKeyframe = null;
    this.postRestore();
    this.audio.rewind();
    this.ui?.toast(`Checkpoint restored · ${checkpoint.label}`, 'success');
  }

  rewindTo(index: number): void {
    const at = this.timeline.restore(this.world, index);
    if (at < 0) return;
    this.clock.paused = true;
    this.clock.reset();
    this.postRestore(false);
    this.activeKeyframe = Math.min(index, this.timeline.keyframes.length - 1);
    this.audio.rewind();
    this.ui?.toast(`Snapshot restored · T+${formatClock(at)} (paused)`, 'info');
    this.syncUi();
  }

  /**
   * Re-syncs renderer/UI after a state restore. Unless this is a timeline
   * rewind, the rewind history is rebased on the restored universe so the
   * scrubber never advertises states from another branch.
   */
  private postRestore(resetTimeline = true): void {
    this.renderer.refreshBodies();
    this.clock.reset();
    this.hoveredId = null;
    this.preview = null;
    if (this.selectedId !== null && !findBody(this.world, this.selectedId)) this.selectedId = null;
    this.objectives.resetTracking();
    if (resetTimeline) {
      this.timeline.clear();
      this.timeline.maybeCapture(this.world, true);
      this.activeKeyframe = null;
    }
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  saveExperiment(name: string): void {
    try {
      const meta = this.store.save(name, this.world);
      this.ui?.toast(`Saved "${meta.name}" (${Math.round(meta.bytes / 1024)} KB)`, 'success');
      this.ui?.invalidatePanel();
      this.syncUi();
    } catch (error) {
      this.audio.error();
      this.ui?.toast((error as Error).message, 'warn');
    }
  }

  loadSave(id: string): void {
    try {
      const doc = this.store.load(id);
      applyExperiment(this.world, doc);
      this.activeScenario = 'custom';
      this.restoreLoadedSpeed();
      this.clock.paused = false;
      this.objectives.reset();
      this.postRestore();
      this.events.push('reset', `Loaded experiment · ${doc.name}`, 0, 0, this.world.time);
      this.camera.snap(0, 0, 3200);
      this.audio.rewind();
      this.ui?.toast(`Loaded "${doc.name}"`, 'success');
    } catch (error) {
      this.audio.error();
      this.ui?.toast((error as Error).message, 'warn');
    }
  }

  renameSave(id: string, name: string): void {
    this.store.rename(id, name);
    this.ui?.invalidatePanel();
    this.syncUi();
  }

  deleteSave(id: string): void {
    try {
      this.store.remove(id);
      this.ui?.toast('Experiment deleted.', 'info');
      this.ui?.invalidatePanel();
      this.syncUi();
    } catch (error) {
      this.ui?.toast((error as Error).message, 'warn');
    }
  }

  exportSave(id: string): void {
    try {
      const { name, json } = this.store.exportJSON(id);
      downloadJSON(`${slugify(name)}.json`, json);
      this.ui?.toast('Experiment exported as JSON.', 'success');
    } catch (error) {
      this.ui?.toast((error as Error).message, 'warn');
    }
  }

  exportCurrent(): void {
    const name = this.activeScenario === 'custom' ? 'GOD MODE experiment' : findScenario(this.activeScenario).name;
    const doc = serializeExperiment(this.world, name);
    downloadJSON(`${slugify(name)}.json`, experimentToJSON(doc));
    this.ui?.toast('Current universe exported as JSON.', 'success');
  }

  importFile(file: File): void {
    file
      .text()
      .then((text) => {
        const doc = this.store.importText(text);
        applyExperiment(this.world, doc);
        this.activeScenario = 'custom';
        this.restoreLoadedSpeed();
        this.clock.paused = false;
        this.objectives.reset();
        this.postRestore();
        this.events.push('reset', `Imported experiment · ${doc.name}`, 0, 0, this.world.time);
        this.camera.snap(0, 0, 3200);
        this.ui?.toast(`Imported "${doc.name}"`, 'success');
      })
      .catch((error: Error) => {
        this.audio.error();
        this.ui?.toast(`Import failed: ${error.message}`, 'warn');
      });
  }

  private restoreLoadedSpeed(): void {
    const speed = this.world.params.speed;
    this.clock.speed = SPEEDS.includes(speed) ? speed : 1;
    this.world.params.speed = this.clock.speed;
  }

  private persistPrefs(): void {
    savePrefs({
      ...this.prefs,
      volume: this.audio.volume,
      muted: this.audio.muted,
      quality: this.quality,
      showPerf: this.perfVisible,
      labels: this.labelsVisible,
    });
  }

  // ----------------------------------------------------------------- UI sync

  private syncUi(): void {
    if (!this.ui) return;
    const body = findBody(this.world, this.selectedId);
    const state: UIState = {
      tool: this.tool,
      selected: body ? this.summarise(body) : null,
      paused: this.clock.paused,
      speed: this.clock.speed,
      quality: this.quality,
      muted: this.audio.muted,
      volume: this.audio.volume,
      trailLength: this.world.params.trailLength,
      gravity: this.world.params.gravity,
      events: this.events.events.slice(0, 40),
      objectives: this.objectives.objectives.map((o) => ({ ...o })),
      scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb })),
      activeScenario: this.activeScenario,
      saves: this.store.list().map((m) => ({ ...m, isSample: m.name.startsWith('Sample ·') })),
      checkpoints: this.checkpoints.map((c) => ({ index: c.index, label: c.label })),
      keyframes: this.timeline.keyframes.map((k) => ({ at: k.at, label: k.label })),
      keyframeIndex: this.activeKeyframe,
      simTime: this.world.time,
      particleCount: this.world.particles.count,
      baseline: this.world.baseline,
      bodyCount: this.world.bodies.length,
      fps: this.perf.fps,
      frameMs: this.perf.frameMs,
      frameP95: this.perf.percentile(0.95),
      drawCalls: this.renderer.diagnostics().calls,
      perfVisible: this.perfVisible,
      labelsVisible: this.labelsVisible,
      toolDefaults: { ...this.toolDefaults },
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      archiveFull: this.store.size >= MAX_SAVES,
    };
    this.ui.sync(state);
    this.updateLabels();
  }

  /** Read-only diagnostics for the benchmark harness and debugging. */
  perfStats(): PerfSnapshot & {
    quality: QualityLevel;
    effectiveQuality: RenderQuality;
    particles: number;
    bodies: number;
    renderer: string;
  } {
    return {
      ...this.perf.snapshot(),
      quality: this.quality,
      effectiveQuality: this.effectiveQuality,
      particles: this.world.particles.count,
      bodies: this.world.bodies.length,
      renderer: this.rendererString(),
    };
  }

  private rendererString(): string {
    try {
      const gl =
        (this.canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
        (this.canvas.getContext('webgl') as WebGLRenderingContext | null);
      if (!gl) return 'unknown';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      return 'unknown';
    }
  }

  private summarise(body: Body): BodySummary {
    return {
      id: body.id,
      kind: body.kind,
      label: body.label,
      x: body.x,
      y: body.y,
      vx: body.vx,
      vy: body.vy,
      mass: body.mass,
      radius: body.radius,
      influence: body.influence,
      strength: body.strength,
      life: body.life,
      maxLife: body.maxLife,
      hue: body.hue,
    };
  }

  private updateLabels(): void {
    if (!this.ui) return;
    if (!this.labelsVisible) {
      this.ui.updateLabels([], false);
      return;
    }
    const pool = this.world.bodies
      .filter(
        (b) =>
          b.id === this.selectedId ||
          b.kind === 'star' ||
          b.kind === 'blackhole' ||
          b.kind === 'well' ||
          b.kind === 'repulsor',
      )
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 9);
    const labels: LabelInfo[] = [];
    for (const body of pool) {
      const screen = this.renderer.worldToScreen(body.x, body.y);
      if (screen.behind) continue;
      if (screen.x < -100 || screen.x > window.innerWidth + 100) continue;
      if (screen.y < -60 || screen.y > window.innerHeight + 60) continue;
      labels.push({
        id: body.id,
        label: body.label,
        kind: body.kind as BodyKind,
        x: screen.x,
        y: screen.y,
        selected: body.id === this.selectedId,
      });
    }
    this.ui.updateLabels(labels, true);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Starting tier for 'auto' on this hardware; the controller refines it. */
function startingTier(): RenderQuality {
  if (typeof navigator === 'undefined') return 'balanced';
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return cores <= 4 || memory <= 4 ? 'performance' : 'balanced';
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'god-mode'
  );
}

