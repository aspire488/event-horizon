import type { CosmicEvent } from '../core/types';
import type { ToolId } from '../core/types';
import { freshMemory, TOOL_INTRO, TOOL_ORDER, type OrbitoContext, type OrbitoMemory } from './knowledge';

export type Mood =
  | 'idle'
  | 'curious'
  | 'excited'
  | 'surprised'
  | 'confused'
  | 'thinking'
  | 'sleepy'
  | 'amused'
  | 'concerned'
  | 'celebrating';

export const MOODS: readonly Mood[] = [
  'idle', 'curious', 'excited', 'surprised', 'confused', 'thinking', 'sleepy', 'amused', 'concerned', 'celebrating',
];

/**
 * Typed things Orbito can notice. Produced by the adapter in orbito.ts.
 * Who caused an event is exact, from its kind: 'blackhole' and 'supernova'
 * only come from the user's tools; 'collapse', 'capture', 'merge',
 * 'absorb' and 'slingshot' only from the simulation.
 */
export type Signal =
  | { type: 'event'; event: CosmicEvent }
  /** The user picked a tool (introduced once, ever). */
  | { type: 'tool'; tool: ToolId }
  | { type: 'paused' }
  | { type: 'resumed' }
  /** No user input for IDLE_PROMPT_S seconds. */
  | { type: 'idle' }
  /** No user input for SLEEP_S seconds. */
  | { type: 'sleep' }
  /** User input after a quiet spell. */
  | { type: 'activity' };

export interface Reaction {
  mood: Mood;
  /** Something worth saying, or null for an expression change only. */
  line: string | null;
  /** Significant enough to be voiced when voice is on. */
  speak: boolean;
  /** Worth a badge if the panel is closed (discoveries). */
  notify: boolean;
}

export const IDLE_PROMPT_S = 75;
export const SLEEP_S = 180;
/** Minimum gap between unsolicited lines. */
export const GLOBAL_GAP_S = 14;
const MOOD_HOLD_S = 6;
const DEMOLITION_WINDOW_S = 60;
const DEMOLITION_COUNT = 4;

type Category =
  | 'blackhole' | 'nova-user' | 'nova-natural' | 'merge' | 'merge-hole' | 'absorb' | 'absorb-danger'
  | 'slingshot' | 'discovery' | 'reset' | 'demolition' | 'idle' | 'wake' | 'tool';

const COOLDOWN_S: Record<Category, number> = {
  blackhole: 20, 'nova-user': 20, 'nova-natural': 15, merge: 25, 'merge-hole': 25, absorb: 60, 'absorb-danger': 60,
  slingshot: 45, discovery: 0, reset: 6, demolition: 90, idle: 0, wake: 120, tool: 0,
};

const LINES: Record<Category, readonly string[]> = {
  blackhole: [
    `Well... that escalated quickly. You've just created a gravitational problem with commitment issues.`,
    `A singularity. Bold. Everything nearby just had its long-term plans cancelled.`,
    `Horizon open. Nothing comes back out of there, so let's not test that personally.`,
    `Another hole in the universe. I'm starting to think you like them.`,
  ],
  'nova-user': [
    `KABOOM. Sorry, I mean: a beautifully expanding shockwave front.`,
    `Watch the ring. Every grain it sweeps over gets shoved outward as the front passes.`,
    `You detonated it. On purpose. I respect the commitment.`,
  ],
  'nova-natural': [
    `Whoa! Nobody touched that star. It ran out of life and went supernova all on its own.`,
    `Stellar collapse! If it was heavy enough, there's a core left in the wreckage.`,
  ],
  merge: [
    `I was emotionally attached to that, actually.`,
    `Merger complete. Momentum conserved, dignity not.`,
    `Two bodies, one survivor. The heavier one always wins here.`,
    `Umm... I think something just had a rather bad day.`,
  ],
  'merge-hole': [
    `The black hole just ate a whole body. Its appetite did not shrink.`,
    `Gone. Past the horizon. I'd hold a small memorial, but it's dark in there.`,
  ],
  absorb: [
    `Matter is crossing the horizon. Each grain makes the hole 2.5 units heavier.`,
    `Hear that? Neither do I. That's the sound of particles ceasing to exist.`,
  ],
  'absorb-danger': [
    `Um. Most of the matter is gone. The black hole is eating the furniture.`,
    `If it keeps feeding like this, there won't be a universe left to observe.`,
    `I have a tiny concern about that black hole. It's eating everything.`,
  ],
  slingshot: [
    `Slingshot! That one dove in and came out screaming.`,
    `Gravity assist spotted. Free speed. Well, borrowed.`,
    `Did you see that flyby? Textbook slingshot.`,
    `Whoa. Did you see that? It came in slow and left in a hurry.`,
  ],
  discovery: [
    `{title}! Okay. I'll admit it. That looks magnificent.`,
    `Logged: {title}. I'm putting that one on the fridge.`,
    `{title}. The universe noticed. So did I.`,
    `Okay... {title}. That was actually beautiful.`,
  ],
  reset: [
    `Fresh universe: {scenario}. Try not to break it in the first minute.`,
    `{scenario} loaded. I already have opinions.`,
    `New world, {scenario}. Same old laws of physics.`,
  ],
  demolition: [
    `You know, some civilizations develop. Yours appears to specialise in demolition.`,
    `That's a lot of destruction for one sitting. Are we testing physics or settling a grudge?`,
    `At this rate the universe is going to need a lawyer.`,
    `Careful! You're getting a little carried away with the destruction.`,
  ],
  idle: [
    `Are we exploring the universe or just staring at it? I can do both, but one is considerably more productive.`,
    `Quiet out there. {particles} grains of matter, all waiting for you. Ask me for an idea.`,
    `I've counted the particles twice. Still {particles}. Your move.`,
  ],
  wake: [`Oh! You're back. I wasn't asleep. I was... observing with my eyes closed.`],
  tool: [`{intro}`],
};

/**
 * Orbito's character state. Pure: no DOM, no timers. `now` is seconds on any
 * monotonic clock, passed in so behaviour is deterministic under test.
 */
export class OrbitoBrain {
  quiet = false;
  memory: OrbitoMemory;
  /** Kind of the last significant event, for "why did that happen?". */
  lastKind: string | undefined;
  /** Bounded short-term observations, newest first. */
  readonly observations: string[] = [];

  private mood: Mood = 'idle';
  private moodUntil = 0;
  private asleep = false;
  private paused = false;
  private lastLineAt = -Infinity;
  private lastEventId = 0;
  private readonly categoryAt = new Map<Category, number>();
  private readonly cursor = new Map<Category, number>();
  private destruction: number[] = [];

  constructor(memory: OrbitoMemory = freshMemory()) {
    this.memory = memory;
  }

  moodAt(now: number): Mood {
    if (now < this.moodUntil) return this.mood;
    if (this.asleep) return 'sleepy';
    return 'idle';
  }

  /** Sets a transient expression (e.g. 'thinking' while answering). */
  express(mood: Mood, now: number, hold = MOOD_HOLD_S): void {
    this.mood = mood;
    this.moodUntil = now + hold;
  }

  observe(signal: Signal, now: number, ctx: OrbitoContext): Reaction | null {
    switch (signal.type) {
      case 'event':
        return this.onEvent(signal.event, now, ctx);
      case 'tool': {
        const bit = 1 << TOOL_ORDER.indexOf(signal.tool);
        if (bit < 1 || this.memory.tools & bit) return null;
        // Marked seen only once actually said, so quiet mode or a busy moment
        // doesn't swallow the introduction forever.
        const r = this.react('tool', 'curious', now, ctx, { speak: false, vars: { intro: TOOL_INTRO[signal.tool] }, gap: 2 });
        if (r.line) this.memory.tools |= bit;
        return r;
      }
      case 'paused':
        this.paused = true;
        this.express('idle', now, 0);
        return { mood: 'idle', line: null, speak: false, notify: false };
      case 'resumed':
        this.paused = false;
        this.express('curious', now, 2.5);
        return { mood: 'curious', line: null, speak: false, notify: false };
      case 'idle':
        // Never nag about inactivity while the user has deliberately paused.
        if (this.paused) return null;
        return this.react('idle', 'curious', now, ctx, { speak: false });
      case 'sleep':
        this.asleep = true;
        this.moodUntil = 0;
        return { mood: 'sleepy', line: null, speak: false, notify: false };
      case 'activity': {
        if (!this.asleep) return null;
        this.asleep = false;
        return this.react('wake', 'surprised', now, ctx, { speak: false, hold: 2.5 });
      }
    }
  }

  private onEvent(event: CosmicEvent, now: number, ctx: OrbitoContext): Reaction | null {
    // Event ids increase monotonically for the app's lifetime: replays and
    // duplicate deliveries are dropped here.
    if (event.id <= this.lastEventId) return null;
    this.lastEventId = event.id;
    this.remember(event.text);

    switch (event.kind) {
      case 'blackhole':
        this.memory.holes += 1;
        this.lastKind = 'blackhole';
        return this.destructive(now, ctx) ?? this.react('blackhole', 'surprised', now, ctx);
      case 'supernova':
        this.lastKind = 'supernova';
        this.memory.novas += 1;
        return this.destructive(now, ctx) ?? this.react('nova-user', 'excited', now, ctx);
      case 'collapse':
        this.lastKind = 'supernova';
        return this.react('nova-natural', 'surprised', now, ctx);
      case 'merge':
        this.memory.merges += 1;
        this.lastKind = 'merge';
        return this.react('merge', 'surprised', now, ctx);
      case 'capture':
        this.memory.merges += 1;
        this.lastKind = 'blackhole';
        return this.react('merge-hole', 'concerned', now, ctx);
      case 'slingshot':
        this.lastKind = 'slingshot';
        if (this.paused) return null;
        return this.react('slingshot', 'celebrating', now, ctx, { speak: false });
      case 'absorb': {
        this.lastKind = 'blackhole';
        const danger = ctx.baseline > 0 && ctx.particles < ctx.baseline * 0.3;
        return this.react(danger ? 'absorb-danger' : 'absorb', danger ? 'concerned' : 'curious', now, ctx, { speak: danger });
      }
      case 'discovery':
        this.memory.discoveries += 1;
        return this.react('discovery', 'celebrating', now, ctx, {
          vars: { title: event.text.replace(/^Discovery\s*—\s*/, '') },
          notify: true,
        });
      case 'reset': {
        this.destruction = [];
        this.lastKind = undefined;
        this.asleep = false;
        // "PRIME FIELD online · 6,808 particles" or "Loaded experiment · My Save".
        // The UI state lags this event by a frame, so the name comes from the text.
        const [head, tail] = event.text.split(' · ');
        const scenario = / online$/.test(head)
          ? head.replace(/ online$/, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
          : tail ?? head;
        return this.react('reset', 'curious', now, ctx, { speak: false, vars: { scenario } });
      }
      default:
        return null;
    }
  }

  /** Repeated user-made destruction earns a sarcastic remark instead. */
  private destructive(now: number, ctx: OrbitoContext): Reaction | null {
    this.destruction = this.destruction.filter((t) => now - t < DEMOLITION_WINDOW_S);
    this.destruction.push(now);
    if (this.destruction.length < DEMOLITION_COUNT) return null;
    const reaction = this.react('demolition', 'amused', now, ctx);
    if (reaction.line) this.destruction = [];
    return reaction;
  }

  private react(
    category: Category,
    mood: Mood,
    now: number,
    ctx: OrbitoContext,
    opts: { speak?: boolean; notify?: boolean; vars?: Record<string, string>; hold?: number; gap?: number } = {},
  ): Reaction {
    this.express(mood, now, opts.hold);
    const priority = category === 'discovery';
    // A world switch is a deliberate context change: it always gets a word in
    // (its own 6s cooldown still stops spam).
    const gap = opts.gap ?? (category === 'reset' ? 0 : priority ? 3 : GLOBAL_GAP_S);
    const last = this.categoryAt.get(category) ?? -Infinity;
    const allowed =
      !(this.quiet && !priority) && now - this.lastLineAt >= gap && now - last >= COOLDOWN_S[category];
    let line: string | null = null;
    if (allowed) {
      line = this.pick(category, { scenario: ctx.scenario, particles: Math.round(ctx.particles).toLocaleString('en-US'), ...opts.vars });
      this.lastLineAt = now;
      this.categoryAt.set(category, now);
    }
    return { mood, line, speak: line !== null && opts.speak !== false, notify: !!opts.notify };
  }

  /** Cycles through a category so the same line never plays twice in a row. */
  private pick(category: Category, vars: Record<string, string>): string {
    const pool = LINES[category];
    const i = this.cursor.get(category) ?? this.memory.sessions;
    this.cursor.set(category, i + 1);
    return pool[i % pool.length].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  }

  private remember(text: string): void {
    this.observations.unshift(text);
    if (this.observations.length > 8) this.observations.length = 8;
  }
}
