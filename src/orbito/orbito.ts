import './orbito.css';
import type { EventLog } from '../core/events';
import type { World } from '../core/types';
import { el } from '../ui/dom';
import type { UIState } from '../ui/ui';
import { IDLE_PROMPT_S, OrbitoBrain, SLEEP_S, type Reaction, type Signal } from './brain';
import {
  answer,
  buildContext,
  freshMemory,
  localResponder,
  type OrbitoContext,
  type OrbitoMemory,
  type Responder,
} from './knowledge';
import { delivery, pickVoice, spokenForm, type VoicePick } from './voice';

export interface OrbitoHost {
  world: () => World;
  events: EventLog;
  /** Called when the conversation opens (e.g. to close a competing panel on mobile). */
  onOpen?: () => void;
  responder?: Responder;
}

const STORE_KEY = 'godmode.orbito.v1';
const MAX_MESSAGES = 40;
const BUBBLE_MS = 7000;
const STARTERS = ["What's happening?", 'Give me an idea', 'Why did that happen?', 'What if I increase its mass?'];

interface Stored {
  memory: OrbitoMemory;
  voice: boolean;
  quiet: boolean;
}

function loadStored(): Stored {
  const fallback: Stored = { memory: freshMemory(), voice: false, quiet: false };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Stored> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    const memory = { ...freshMemory() };
    for (const k of Object.keys(memory) as (keyof OrbitoMemory)[]) {
      const v = raw.memory?.[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) memory[k] = Math.floor(v);
    }
    return { memory, voice: raw.voice === true, quiet: raw.quiet === true };
  } catch {
    return fallback;
  }
}

const now = () => performance.now() / 1000;

const CREATURE_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="orbito-skin" cx="38%" cy="32%" r="72%">
      <stop offset="0" stop-color="#4b3d9a"/>
      <stop offset="0.55" stop-color="#16204a"/>
      <stop offset="1" stop-color="#060a18"/>
    </radialGradient>
    <radialGradient id="orbito-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0.45" stop-color="currentColor" stop-opacity="0.35"/>
      <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle class="o-halo" cx="32" cy="33" r="31" fill="url(#orbito-halo)"/>
  <g class="o-orbit o-orbit-back"><circle class="o-ring" cx="32" cy="32" r="28"/><g class="o-spin"><circle cx="60" cy="32" r="1.6"/><circle cx="4" cy="32" r="1.1"/></g></g>
  <g class="o-tilt">
    <circle class="o-body" cx="32" cy="34" r="19" fill="url(#orbito-skin)"/>
    <path class="o-rim" d="M17 27 A17 17 0 0 1 40 17" fill="none"/>
    <g class="o-face">
      <g class="o-eye o-eye-l"><ellipse cx="25" cy="32" rx="3.3" ry="4.4"/><circle class="o-glint" cx="26.1" cy="30.4" r="1"/></g>
      <g class="o-eye o-eye-r"><ellipse cx="39" cy="32" rx="3.3" ry="4.4"/><circle class="o-glint" cx="40.1" cy="30.4" r="1"/></g>
      <path class="o-smile" d="M27.5 40.5 Q32 44.5 36.5 40.5" fill="none"/>
      <ellipse class="o-oh" cx="32" cy="42" rx="2" ry="2.4"/>
      <path class="o-worry" d="M28 42.5 Q32 40 36 42.5" fill="none"/>
    </g>
  </g>
  <g class="o-orbit o-orbit-front"><g class="o-spin"><circle cx="32" cy="60" r="1.4"/></g></g>
  <text class="o-z" x="46" y="16">z</text>
</svg>`;

/**
 * Orbito: the cosmic companion. Observes the universe only through the typed
 * EventLog subscription (slingshots included) and the UI
 * state App already publishes — it never touches physics or the renderer.
 */
export class Orbito {
  private readonly brain: OrbitoBrain;
  private readonly root: HTMLElement;
  private readonly creature: HTMLButtonElement;
  private readonly bubble: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly log: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly voiceButton: HTMLButtonElement;
  private readonly quietButton: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly responder: Responder;
  private readonly synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  private state: UIState | null = null;
  private voicePick: VoicePick<SpeechSynthesisVoice> = { voice: null, pitch: 1.35, rate: 1.04 };
  private open = false;
  private voice: boolean;
  private muted = false;
  private volume = 1;
  private lastActivity = now();
  private idlePrompted = false;
  private sleeping = false;
  private disposed = false;
  private readonly timers = new Set<number>();
  private moodTimer = 0;
  private bubbleTimer = 0;
  private idleTimer = 0;
  private readonly unsubscribe: () => void;

  constructor(mount: HTMLElement, private readonly host: OrbitoHost) {
    const stored = loadStored();
    stored.memory.sessions += 1;
    this.brain = new OrbitoBrain(stored.memory);
    this.brain.quiet = stored.quiet;
    this.voice = stored.voice && this.synth !== null;
    this.responder = host.responder ?? localResponder;

    this.root = el('div', 'orbito');
    this.root.dataset.mood = 'idle';

    this.creature = el('button', 'orbito-creature');
    this.creature.type = 'button';
    this.creature.setAttribute('aria-label', 'Orbito, your cosmic companion. Open conversation');
    this.creature.setAttribute('aria-expanded', 'false');
    this.creature.setAttribute('aria-controls', 'orbito-panel');
    this.creature.innerHTML = CREATURE_SVG;
    this.badge = el('span', 'orbito-badge');
    this.badge.hidden = true;
    this.creature.appendChild(this.badge);
    this.creature.addEventListener('click', () => this.setOpen(!this.open));

    this.bubble = el('div', 'orbito-bubble');
    this.bubble.setAttribute('role', 'status');
    this.bubble.setAttribute('aria-live', 'polite');
    this.bubble.addEventListener('click', () => this.setOpen(true));

    this.panel = el('section', 'orbito-panel');
    this.panel.id = 'orbito-panel';
    this.panel.setAttribute('aria-label', 'Conversation with Orbito');
    this.panel.hidden = true;

    const head = el('header', 'orbito-head');
    const title = el('div', 'orbito-title');
    title.append(el('span', 'orbito-name', 'ORBITO'), el('span', 'orbito-role', 'cosmic companion'));
    const tools = el('div', 'orbito-tools');
    this.voiceButton = this.toggle('VOICE', 'Speak replies and big moments aloud', () => {
      this.voice = !this.voice;
      if (!this.voice) this.synth?.cancel();
      this.refreshToggles();
      this.persist();
    });
    this.voiceButton.hidden = this.synth === null;
    // Chrome fills the voice list asynchronously: re-pick when it arrives.
    try {
      this.synth?.addEventListener('voiceschanged', this.loadVoices);
    } catch {
      // Older engines without EventTarget on speechSynthesis: initial list only.
    }
    this.loadVoices();
    this.quietButton = this.toggle('QUIET', 'Only speak when spoken to (and for discoveries)', () => {
      this.brain.quiet = !this.brain.quiet;
      this.refreshToggles();
      this.persist();
    });
    const close = el('button', 'orbito-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close conversation');
    close.addEventListener('click', () => this.setOpen(false));
    tools.append(this.voiceButton, this.quietButton, close);
    head.append(title, tools);

    this.log = el('div', 'orbito-log');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    this.log.tabIndex = 0;

    const chips = el('div', 'orbito-chips');
    for (const text of STARTERS) {
      const chip = el('button', 'orbito-chip', text);
      chip.type = 'button';
      chip.addEventListener('click', () => this.ask(text));
      chips.appendChild(chip);
    }

    const form = el('form', 'orbito-form');
    this.input = el('input', 'orbito-input');
    this.input.type = 'text';
    this.input.maxLength = 240;
    this.input.placeholder = 'Ask Orbito…';
    this.input.setAttribute('aria-label', 'Message Orbito');
    this.input.autocomplete = 'off';
    const send = el('button', 'orbito-send', 'SEND');
    send.type = 'submit';
    form.append(this.input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = '';
      this.ask(text);
    });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.setOpen(false);
        this.creature.focus();
      }
    });

    this.panel.append(head, this.log, chips, form);
    this.root.append(this.panel, this.bubble, this.creature);
    mount.appendChild(this.root);
    this.refreshToggles();

    this.unsubscribe = host.events.subscribe((event) => this.signal({ type: 'event', event }));
    window.addEventListener('pointerdown', this.onActivity, { capture: true, passive: true });
    window.addEventListener('keydown', this.onActivity, { capture: true, passive: true });
    window.addEventListener('wheel', this.onActivity, { capture: true, passive: true });
    this.armIdle(IDLE_PROMPT_S);
    this.persist();

    if (stored.memory.sessions === 1) {
      this.later(4500, () =>
        this.say(`Hi! I'm Orbito. I live here. Poke the universe and I'll tell you what it's doing. Click me to chat.`, false),
      );
    }
  }

  /** Called from App.syncUi with the state it already publishes. */
  sync(state: UIState, collapsed: boolean): void {
    const prev = this.state;
    this.state = state;
    this.root.classList.toggle('orbito-hidden', collapsed);
    if (state.muted !== this.muted) {
      this.muted = state.muted;
      if (this.muted) this.synth?.cancel();
    }
    this.volume = state.volume;
    if (prev && prev.paused !== state.paused) this.signal({ type: state.paused ? 'paused' : 'resumed' });
    if (prev && prev.tool !== state.tool) this.signal({ type: 'tool', tool: state.tool });
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.panel.hidden = !open;
    this.creature.setAttribute('aria-expanded', String(open));
    this.creature.setAttribute('aria-label', open ? 'Orbito. Close conversation' : 'Orbito, your cosmic companion. Open conversation');
    if (open) {
      this.badge.hidden = true;
      this.hideBubble();
      if (!this.log.firstChild) {
        this.post('orbito', `Orbito here. I can see ${this.context().scenario}. Ask me anything about it.`);
      }
      this.host.onOpen?.();
      this.input.focus({ preventScroll: true });
    } else {
      // Closing Orbito is an interruption: stop talking.
      this.synth?.cancel();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    window.removeEventListener('pointerdown', this.onActivity, { capture: true });
    window.removeEventListener('keydown', this.onActivity, { capture: true });
    window.removeEventListener('wheel', this.onActivity, { capture: true });
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.moodTimer);
    clearTimeout(this.bubbleTimer);
    clearTimeout(this.idleTimer);
    try {
      this.synth?.removeEventListener('voiceschanged', this.loadVoices);
      this.synth?.cancel();
    } catch {
      // see constructor
    }
    this.persist();
    this.root.remove();
  }

  // ------------------------------------------------------------ internals

  private context(): OrbitoContext {
    const s = this.state;
    return buildContext(this.host.world(), {
      scenario: s?.scenarios.find((x) => x.id === s.activeScenario)?.name ?? 'this universe',
      paused: s?.paused ?? false,
      speed: s?.speed ?? 1,
      tool: s?.tool ?? 'observe',
      objectives: s?.objectives ?? [],
      recent: this.host.events.events,
      selectedId: s?.selected?.id ?? null,
    });
  }

  private signal(signal: Signal): void {
    if (this.disposed) return;
    this.apply(this.brain.observe(signal, now(), this.context()));
  }

  private apply(reaction: Reaction | null): void {
    if (!reaction) return;
    this.showMood();
    if (reaction.line) this.say(reaction.line, reaction.speak);
    if (reaction.notify && !this.open) this.badge.hidden = false;
    this.persist();
  }

  private showMood(): void {
    const t = now();
    this.root.dataset.mood = this.brain.moodAt(t);
    clearTimeout(this.moodTimer);
    // One timer re-reads the mood when the current expression's hold expires.
    this.moodTimer = window.setTimeout(() => {
      if (!this.disposed) this.root.dataset.mood = this.brain.moodAt(now());
    }, 6100);
  }

  private say(line: string, speak: boolean): void {
    this.post('orbito', line);
    if (!this.open) {
      this.bubble.textContent = line;
      this.bubble.classList.add('show');
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = window.setTimeout(() => this.hideBubble(), BUBBLE_MS);
    }
    if (speak) this.speak(line);
  }

  private hideBubble(): void {
    this.bubble.classList.remove('show');
  }

  private post(from: 'orbito' | 'you', text: string): void {
    const row = el('p', `orbito-msg orbito-msg-${from}`);
    row.append(el('span', 'orbito-who', from === 'you' ? 'YOU' : 'ORBITO'), el('span', 'orbito-text', text));
    this.log.appendChild(row);
    while (this.log.childElementCount > MAX_MESSAGES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  private ask(question: string): void {
    this.post('you', question);
    this.brain.express('thinking', now(), 1.2);
    this.showMood();
    const ctx = this.context();
    const memory = this.brain.memory;
    const lastKind = this.brain.lastKind;
    // A short beat of "thinking" so the reply reads as considered, not canned.
    this.later(380, () => {
      // Any responder failure (network, provider down) falls back to the local brain.
      Promise.resolve()
        .then(() => this.responder(question, ctx, memory, lastKind))
        .catch(() => answer(question, ctx, memory, lastKind))
        .then((reply) => {
          if (this.disposed) return;
          this.brain.express(reply.mood, now());
          this.showMood();
          this.post('orbito', reply.text);
          // Closed during the thinking beat: that's an interruption, stay silent.
          if (this.open) this.speak(reply.text);
        });
    });
  }

  private loadVoices = (): void => {
    try {
      this.voicePick = pickVoice(this.synth?.getVoices() ?? []);
      this.root.dataset.voice = this.voicePick.voice?.name ?? '';
    } catch {
      // Speech is optional; text keeps working.
    }
  };

  private speak(text: string): void {
    if (!this.synth || !this.voice || this.muted || this.volume <= 0 || document.hidden) return;
    try {
      this.synth.cancel(); // never overlap
      const said = spokenForm(text);
      if (!said) return;
      const u = new SpeechSynthesisUtterance(said);
      const pick = this.voicePick;
      const shift = delivery(this.brain.moodAt(now()));
      u.pitch = Math.min(2, Math.max(0, pick.pitch + shift.pitch));
      u.rate = Math.min(1.4, Math.max(0.7, pick.rate + shift.rate));
      u.volume = Math.min(1, this.volume);
      if (pick.voice) {
        u.voice = pick.voice;
        u.lang = pick.voice.lang;
      } else u.lang = 'en-US';
      u.onstart = () => this.root.classList.add('orbito-speaking');
      u.onend = u.onerror = () => this.root.classList.remove('orbito-speaking');
      this.synth.speak(u);
    } catch {
      this.root.classList.remove('orbito-speaking');
    }
  }

  private onActivity = (): void => {
    this.lastActivity = now();
    if (!this.idlePrompted && !this.sleeping) return;
    this.idlePrompted = false;
    this.sleeping = false;
    this.signal({ type: 'activity' });
    this.armIdle(IDLE_PROMPT_S);
  };

  /** A single re-armed timeout replaces any polling loop for inactivity. */
  private armIdle(seconds: number): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(this.checkIdle, Math.max(1, seconds) * 1000);
  }

  private checkIdle = (): void => {
    if (this.disposed) return;
    const quiet = now() - this.lastActivity;
    if (!this.idlePrompted && quiet >= IDLE_PROMPT_S) {
      this.idlePrompted = true;
      if (!this.open) this.signal({ type: 'idle' });
    }
    if (!this.sleeping && quiet >= SLEEP_S) {
      this.sleeping = true;
      this.signal({ type: 'sleep' });
    }
    if (!this.idlePrompted) this.armIdle(IDLE_PROMPT_S - quiet);
    else if (!this.sleeping) this.armIdle(SLEEP_S - quiet);
  };

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }

  private toggle(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'orbito-toggle', label);
    b.type = 'button';
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  private refreshToggles(): void {
    this.voiceButton.setAttribute('aria-pressed', String(this.voice));
    this.quietButton.setAttribute('aria-pressed', String(this.brain.quiet));
  }

  private persist(): void {
    try {
      const data: Stored = { memory: this.brain.memory, voice: this.voice, quiet: this.brain.quiet };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      // Private mode / blocked storage: personality just won't carry over.
    }
  }
}
