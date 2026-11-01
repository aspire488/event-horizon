import { circularOrbitSpeed, MAX_ACCEL, MAX_SPEED } from '../core/physics';
import type { BodyKind, CosmicEvent, SimStats, ToolId, World } from '../core/types';
import { HORIZON_FACTOR, PARTICLE_CAPACITY } from '../core/world';

/**
 * Everything Orbito knows about the universe at one instant. Built on demand
 * (when something happens or the user asks) from the live World plus the UI
 * state App already publishes — never polled, never mutated.
 */
export interface BodyFact {
  id: number;
  kind: BodyKind;
  label: string;
  mass: number;
  radius: number;
  speed: number;
  x: number;
  y: number;
  /** Event horizon radius; 0 for anything that is not a black hole. */
  horizon: number;
  /** Seconds until a star collapses; -1 when stable. */
  life: number;
  influence: number;
  strength: number;
}

export interface OrbitoContext {
  scenario: string;
  paused: boolean;
  speed: number;
  gravity: number;
  time: number;
  particles: number;
  baseline: number;
  tool: ToolId;
  /** Heaviest first, at most 8. */
  bodies: BodyFact[];
  counts: Record<BodyKind, number>;
  stats: SimStats;
  objectives: { title: string; hint: string; done: boolean; progress: number }[];
  /** Newest first, at most 6. */
  recent: CosmicEvent[];
  selected: BodyFact | null;
}

export interface ContextExtras {
  scenario: string;
  paused: boolean;
  speed: number;
  tool: ToolId;
  objectives: { title: string; hint: string; done: boolean; progress: number }[];
  recent: readonly CosmicEvent[];
  selectedId: number | null;
}

/** Long-lived personality memory, persisted by the view (tiny, bounded). */
export interface OrbitoMemory {
  sessions: number;
  holes: number;
  novas: number;
  merges: number;
  discoveries: number;
  /** Bitmask over TOOL_ORDER: tools Orbito has already introduced. */
  tools: number;
}

export function freshMemory(): OrbitoMemory {
  return { sessions: 0, holes: 0, novas: 0, merges: 0, discoveries: 0, tools: 0 };
}

/** Same order as the 1–7 keys. */
export const TOOL_ORDER: readonly ToolId[] = ['observe', 'gravity', 'blackhole', 'supernova', 'repel', 'paint', 'orbit'];

/** What each tool really does, in the simulation's own terms. */
export const TOOL_INTRO: Record<ToolId, string> = {
  observe: `Observe: click a body to inspect it, drag to move it. Moving something keeps its velocity, so you can drop a planet into trouble.`,
  gravity: `Gravity well: a pull of mass × strength that stops at its influence ring. Matter inside can orbit; matter outside doesn't feel it.`,
  blackhole: `Black hole: anything that crosses its horizon (2.4× its radius) is gone for good, and it wins every merger. Use responsibly. Or don't.`,
  supernova: `Supernova: a shockwave ring that shoves matter outward as it sweeps past. Fire it into thick dust for the Shockwave mission.`,
  repel: `Repulsor: pushes matter out to its ring with strength × 1,100. Mass makes no difference to it.`,
  paint: `Paint: drag to pour matter. Faster strokes launch faster grains, and a quick stroke that skims a heavy star is how slingshots happen.`,
  orbit: `Orbit: click near a mass and I'll launch a planet at exactly √(GM/r), a circular orbit. Drag before letting go to choose the radius.`,
};

/** One grounded experiment per world, keyed by scenario name. */
const SCENARIO_IDEA: Record<string, string> = {
  'Prime Field': `Select a planet and double its mass in the Force Lab. Its moons are suddenly too slow and drop into tighter, wilder orbits.`,
  'Binary Dance': `Launch a planet (7) far outside both stars for a circumbinary orbit. Then try one between them and watch it get evicted.`,
  'The Hungry Singularity': `Paint a stream that just misses the hole. Some of it spirals in, some gets flung: accretion and slingshot in one stroke.`,
  'Stellar Collapse': `Don't touch anything. Wait for the star to die on its own, then ask me what happened.`,
  Slingshot: `Select the star and watch the stream bend around it. Add a gravity well on the far side to change where it gets flung.`,
  'Total Chaos': `Pick which singularity you think survives, then press Space and let it run. Place your bets.`,
};

export function buildContext(world: World, x: ContextExtras): OrbitoContext {
  const counts: Record<BodyKind, number> = { star: 0, planet: 0, blackhole: 0, well: 0, repulsor: 0 };
  const facts: BodyFact[] = world.bodies.map((b) => {
    counts[b.kind] += 1;
    return {
      id: b.id,
      kind: b.kind,
      label: b.label,
      mass: b.mass,
      radius: b.radius,
      speed: Math.hypot(b.vx, b.vy),
      x: b.x,
      y: b.y,
      horizon: b.kind === 'blackhole' ? b.radius * HORIZON_FACTOR : 0,
      life: b.life,
      influence: b.influence,
      strength: b.strength,
    };
  });
  const selected = facts.find((f) => f.id === x.selectedId) ?? null;
  facts.sort((a, b) => b.mass - a.mass);
  return {
    scenario: x.scenario,
    paused: x.paused,
    speed: x.speed,
    gravity: world.params.gravity,
    time: world.time,
    particles: world.particles.count,
    baseline: world.baseline,
    tool: x.tool,
    bodies: facts.slice(0, 8),
    counts,
    stats: { ...world.stats },
    objectives: x.objectives.map((o) => ({ ...o })),
    recent: x.recent.slice(0, 6),
    selected,
  };
}

// ------------------------------------------------------------------ answers

export type AnswerMood = 'curious' | 'excited' | 'thinking' | 'confused' | 'amused' | 'concerned' | 'celebrating' | 'idle';

export interface Answer {
  mood: AnswerMood;
  text: string;
}

/**
 * Seam for a future LLM: anything that turns a question plus structured
 * context into an answer. The shipped implementation is `localResponder`;
 * a remote one must live behind a server so no key reaches the browser.
 */
export type Responder = (
  question: string,
  ctx: OrbitoContext,
  memory: OrbitoMemory,
  lastKind?: string,
) => Promise<Answer>;

export const localResponder: Responder = async (question, ctx, memory, lastKind) => answer(question, ctx, memory, lastKind);

const r = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, word: string) => `${r(n)} ${word}${n === 1 ? '' : 's'}`;

const KIND_NAME: Record<BodyKind, string> = {
  star: 'star',
  planet: 'planet',
  blackhole: 'black hole',
  well: 'gravity well',
  repulsor: 'repulsor',
};

function bodyCensus(ctx: OrbitoContext): string {
  const parts = (Object.keys(ctx.counts) as BodyKind[])
    .filter((k) => ctx.counts[k] > 0)
    .map((k) => plural(ctx.counts[k], KIND_NAME[k]));
  return parts.length ? parts.join(', ') : 'no bodies at all';
}

function heaviest(ctx: OrbitoContext, exclude?: number): BodyFact | null {
  return ctx.bodies.find((b) => b.id !== exclude && forceLike(b) > 0) ?? null;
}

/** Mirrors core/world.forceMass for a BodyFact. */
function forceLike(b: BodyFact): number {
  if (b.kind === 'repulsor') return -b.strength * 1100;
  if (b.kind === 'well') return b.mass * b.strength;
  return b.mass;
}

export function describe(ctx: OrbitoContext): string {
  const total = ctx.counts.star + ctx.counts.planet + ctx.counts.blackhole + ctx.counts.well + ctx.counts.repulsor;
  const pct = ctx.baseline > 0 ? Math.round((ctx.particles / ctx.baseline) * 100) : 100;
  let text = `${ctx.scenario}, T+${ctx.time.toFixed(1)}s, ${ctx.paused ? 'paused' : `running at ${ctx.speed}×`}. `;
  text += `${r(ctx.particles)} grains of matter (${pct}% of the starting ${r(ctx.baseline)}) and ${plural(total, 'body')}: ${bodyCensus(ctx)}.`;
  const top = ctx.bodies[0];
  if (top) {
    text += ` Heaviest is ${top.label} at ${r(top.mass)} mass units`;
    text += top.horizon ? ` with a ${r(top.horizon)}u event horizon.` : '.';
  }
  if (ctx.recent[0]) text += ` Latest in the log: "${ctx.recent[0].text}".`;
  return text;
}

const EXPLAIN: Record<string, (ctx: OrbitoContext) => string> = {
  blackhole: (ctx) => {
    const holes = ctx.bodies.filter((b) => b.kind === 'blackhole');
    let t =
      `Here a black hole's event horizon is ${HORIZON_FACTOR}× its drawn radius. Matter inside it is deleted on the spot, ` +
      `and each grain adds 2.5 mass units plus its momentum (capped at 26,000). Within 3.6 horizons there's accretion drag, which is why ` +
      `matter spirals in instead of orbiting forever. It also wins every merge, whatever the masses.`;
    if (holes.length) {
      t += ` Right now: ${holes.map((h) => `${h.label} (${r(h.mass)} mass, ${r(h.horizon)}u horizon)`).join(', ')}.`;
      t += ` ${r(ctx.stats.absorbedByBlackHole)} particles swallowed so far.`;
    } else t += ` There are none in this universe at the moment. Press 3 if you're feeling irresponsible.`;
    return t;
  },
  supernova: (ctx) => {
    let t =
      `A supernova here is a shockwave ring expanding at 760×√power u/s out to 1,500×power units. Every particle in its path ` +
      `is pushed outward for as long as the 260-unit-wide front overlaps it, a fraction of a second. Stars with a finite lifetime collapse on their own, and if they're heavier than 320 ` +
      `they leave a white core behind.`;
    const dying = ctx.bodies.filter((b) => b.kind === 'star' && b.life > 0).sort((a, b) => a.life - b.life)[0];
    if (dying) t += ` Heads up: ${dying.label} has about ${Math.ceil(dying.life)}s left.`;
    t += ` ${plural(ctx.stats.supernovas, 'supernova')} so far.`;
    return t;
  },
  merge: (ctx) =>
    `Two bodies merge when their centres get within 0.72× their combined radii, or when one crosses a black hole's horizon. ` +
    `The heavier one survives (a black hole always does), the result sits at the pair's centre of mass with their combined momentum, and ordinary bodies combine by volume, ` +
    `so radii add as cube roots. ${plural(ctx.stats.merged, 'merger')} so far.`,
  slingshot: (ctx) => {
    let t =
      `A slingshot counts when a particle dives toward a body of 400+ mass faster than 120 u/s, then leaves outbound faster ` +
      `than 170 u/s beyond 260 units. Particles don't tug back on bodies in this universe, so the "free" speed comes from ` +
      `falling through a moving, multi-body potential. A planet gets flung the same way by body-to-body gravity: if a close ` +
      `pass leaves it faster than the escape speed √(2GM/r), it's gone.`;
    const fastest = [...ctx.bodies].filter((b) => b.kind === 'planet' || b.kind === 'star').sort((a, b) => b.speed - a.speed)[0];
    const anchor = fastest ? heaviest(ctx, fastest.id) : null;
    if (fastest && anchor) {
      const d = Math.max(1, Math.hypot(fastest.x - anchor.x, fastest.y - anchor.y));
      const escape = Math.sqrt((2 * ctx.gravity * Math.abs(forceLike(anchor))) / d);
      t += ` Example: ${fastest.label} is moving at ${r(fastest.speed)} u/s, ${r(d)}u from ${anchor.label}, where escape speed is ~${r(escape)} u/s, so it's ${fastest.speed > escape ? 'not coming back' : 'still bound'}.`;
    }
    return t + ` Slingshots logged: ${r(ctx.stats.slingshots)}.`;
  },
  orbit: (ctx) => {
    const anchor = ctx.selected && forceLike(ctx.selected) > 0 ? ctx.selected : heaviest(ctx);
    let t =
      `A circular orbit needs speed v = √(G·M/r). The Orbit tool (7) computes exactly that around the nearest mass, ` +
      `so a click gives you a clean circle.`;
    if (anchor) {
      const v = circularOrbitSpeed(Math.abs(forceLike(anchor)), 400, ctx.gravity);
      t += ` Around ${anchor.label} at 400 units that's ~${r(v)} u/s with G = ${r(ctx.gravity)}.`;
    }
    return t + ` The "Stable orbit" mission wants one particle to complete a full lap around the same body.`;
  },
  gravity: (ctx) =>
    `The gravitational constant is ${r(ctx.gravity)} (default 3,000). Every pull scales linearly with it and orbital ` +
    `speeds scale with √G, so doubling it makes existing orbits too slow and they fall inward. Forces are softened ` +
    `(Plummer). Matter is also clamped at ${r(MAX_ACCEL)} u/s² acceleration and ${r(MAX_SPEED)} u/s speed; bodies are only softened, so close passes stay finite.`,
  wells: () =>
    `A gravity well pulls with mass × strength, but only inside its influence radius, fading smoothly over the outer 28%. ` +
    `A repulsor pushes with strength × 1,100 inside its radius. Mass is irrelevant to it. Neither attracts other bodies ` +
    `beyond normal body gravity, and their influence ends exactly at the ring.`,
  matter: (ctx) =>
    `Matter is a fixed pool of ${r(PARTICLE_CAPACITY)} slots. When it's full, painting recycles the oldest grains in a ` +
    `deterministic order. Particles feel bodies but don't pull on them, though a black hole takes on the momentum of whatever it swallows. Currently ${r(ctx.particles)} are alive.`,
  time: () =>
    `Physics ticks at a fixed 1/60 s whatever your frame rate, and a scenario is seeded, so the same world starts ` +
    `identically every time. Pause with Space, change speed with + and −, scrub back with the rewind bar, or undo with Z.`,
};

const JOKES = [
  `Why did the photon refuse to check a bag? It was travelling light.`,
  `I told a joke about a black hole once. It sucked. Nothing escaped, not even the laughter.`,
  `A neutron walks into a bar and asks how much a drink is. "For you? No charge."`,
];

function suggest(ctx: OrbitoContext): string {
  const next = ctx.objectives.find((o) => !o.done);
  const idea = SCENARIO_IDEA[ctx.scenario];
  if (next) {
    const pct = Math.round(next.progress * 100);
    const tail = idea ? ` Or, in this world: ${idea}` : '';
    return `Try "${next.title}"${pct ? `, you're ${pct}% there` : ''}: ${next.hint} ${missionTip(next.title)}${tail}`;
  }
  if (idea) return `All missions done. Experiment for ${ctx.scenario}: ${idea}`;
  if (ctx.counts.blackhole === 0) return `Every mission's done. Show-off. Drop a black hole beside the heaviest star and watch who wins.`;
  return `All missions complete. Free play: crank gravity to 6,000 and see which orbits survive, or paint a stream straight past a black hole.`;
}

function missionTip(title: string): string {
  if (/orbit/i.test(title)) return `Tip: the Orbit tool (7) next to a star does the maths for you.`;
  if (/horizon/i.test(title)) return `Tip: paint matter (6) toward a black hole rather than at it, so it spirals in.`;
  if (/merge/i.test(title)) return `Tip: drag one star into another with Observe (1).`;
  if (/shock/i.test(title)) return `Tip: detonate (4) in the thickest dust you can find.`;
  if (/sling/i.test(title)) return `Tip: paint a fast stroke that skims past a heavy star without hitting it.`;
  return '';
}

function opinion(ctx: OrbitoContext): Answer {
  const pct = ctx.baseline ? ctx.particles / ctx.baseline : 1;
  if (ctx.counts.blackhole >= 3)
    return { mood: 'concerned', text: `${ctx.counts.blackhole} black holes? Honestly, that's not a universe, that's a drain.` };
  if (pct < 0.3)
    return { mood: 'concerned', text: `You've lost ${Math.round((1 - pct) * 100)}% of the matter. It's getting lonely in here.` };
  if (ctx.stats.supernovas > 4)
    return { mood: 'amused', text: `${ctx.stats.supernovas} supernovas. It's bold. It's loud. I'd call it explosive minimalism.` };
  if (ctx.objectives.every((o) => o.done))
    return { mood: 'celebrating', text: `My opinion? Every mission complete, so you clearly know what you're doing. Mostly.` };
  return {
    mood: 'amused',
    text: `${ctx.scenario} with ${bodyCensus(ctx)}? Tasteful. A little restrained. I'd add one more thing that could go horribly wrong.`,
  };
}

/** Deterministic, context-grounded reply. First matching intent wins. */
export function answer(question: string, ctx: OrbitoContext, memory: OrbitoMemory, lastKind?: string): Answer {
  const q = question.toLowerCase().trim();
  if (!q) return { mood: 'confused', text: `That was a very quiet question. Even for space.` };

  if (/\b(hi|hello|hey|yo|greetings)\b/.test(q) && q.length < 24) {
    const back = memory.sessions > 1 ? ` Session ${memory.sessions} together. You've opened ${plural(memory.holes, 'black hole')} on my watch.` : '';
    return { mood: 'excited', text: `Hello, creator of worlds.${back} Ask me what's going on, or ask for an idea.` };
  }
  if (/who are you|your name|what are you/.test(q))
    return {
      mood: 'amused',
      text: `I'm Orbito, a small, round, and frankly underpaid resident of this universe. I watch what happens, explain the physics, and comment when you break things.`,
    };
  if (/joke|funny|laugh/.test(q)) return { mood: 'amused', text: JOKES[memory.sessions % JOKES.length] };
  if (/thank/.test(q)) return { mood: 'excited', text: `Any time. I'd say it's my job, but nobody hired me.` };
  if (/\b(bye|goodnight|see you)\b/.test(q)) return { mood: 'idle', text: `I'll be here. Floating. Judging gently.` };

  if (/this tool|what does (it|this)|how do i use|which tool|current tool/.test(q))
    return { mood: 'curious', text: `You're holding ${TOOL_INTRO[ctx.tool]}` };
  if (/what if|increase|heavier|more mass|double|bigger|lighter|less mass/.test(q)) return whatIfMass(ctx, q);
  if (/eject|fl[iu]ng|slingshot|thrown|escape|shot off|flew/.test(q)) return { mood: 'thinking', text: EXPLAIN.slingshot(ctx) };
  if (/black ?hole|singularit|horizon|swallow|absorb|accret/.test(q)) return { mood: 'thinking', text: EXPLAIN.blackhole(ctx) };
  if (/supernova|explo|shock|detonat|collapse/.test(q)) return { mood: 'excited', text: EXPLAIN.supernova(ctx) };
  if (/merge|collid|collision|crash|smash/.test(q)) return { mood: 'thinking', text: EXPLAIN.merge(ctx) };
  if (/orbit|circle|lap/.test(q)) return { mood: 'thinking', text: EXPLAIN.orbit(ctx) };
  if (/gravit(y|ational) (constant|slider)|\bg\b|gravity/.test(q)) return { mood: 'thinking', text: EXPLAIN.gravity(ctx) };
  if (/well|repul|push|influence/.test(q)) return { mood: 'thinking', text: EXPLAIN.wells(ctx) };
  if (/particle|matter|dust|paint/.test(q)) return { mood: 'thinking', text: EXPLAIN.matter(ctx) };
  if (/pause|rewind|undo|time|speed|determin/.test(q)) return { mood: 'thinking', text: EXPLAIN.time(ctx) };

  if (/mission|objective|goal|progress/.test(q)) {
    const done = ctx.objectives.filter((o) => o.done).length;
    const list = ctx.objectives.map((o) => `${o.done ? '✓' : `${Math.round(o.progress * 100)}%`} ${o.title}`).join(' · ');
    return { mood: done === ctx.objectives.length ? 'celebrating' : 'curious', text: `${done}/${ctx.objectives.length} missions: ${list}.` };
  }
  if (/suggest|idea|what should|bored|try|next|help/.test(q)) return { mood: 'excited', text: suggest(ctx) };
  if (/think|opinion|like it|rate|beautiful|good|how am i/.test(q)) return opinion(ctx);
  if (/why|how come|what caused|what made/.test(q)) {
    if (lastKind && EXPLAIN[lastKind]) return { mood: 'thinking', text: EXPLAIN[lastKind](ctx) };
    return { mood: 'confused', text: `Why what, exactly? Nothing dramatic has happened yet. Make something happen and ask me again.` };
  }
  if (/happen|going on|status|see|state|universe|what.*now|summar/.test(q)) return { mood: 'curious', text: describe(ctx) };

  return {
    mood: 'confused',
    text:
      `That one sails past my event horizon. I only see what this universe reports: bodies, matter, events and missions. ` +
      `Try "what's happening?", "why did that get ejected?", or "what if I increase its mass?"`,
  };
}

function whatIfMass(ctx: OrbitoContext, q: string): Answer {
  const target = ctx.selected ?? (/black ?hole/.test(q) ? ctx.bodies.find((b) => b.kind === 'blackhole') : null) ?? ctx.bodies[0];
  if (!target)
    return { mood: 'confused', text: `There's nothing here to make heavier. Spawn a star or select a body first, then ask again.` };
  const who = ctx.selected ? `${target.label} (selected)` : `${target.label}, the ${KIND_NAME[target.kind]} I'm assuming you mean`;
  if (target.kind === 'repulsor')
    return { mood: 'thinking', text: `${who} ignores mass completely. Its push is strength × 1,100. Turn up the strength or influence instead.` };
  const now = Math.abs(forceLike(target));
  const v1 = circularOrbitSpeed(now, 400, ctx.gravity);
  const v2 = circularOrbitSpeed(now * 2, 400, ctx.gravity);
  let t = `Doubling ${who}: its pull doubles, and circular orbits at 400u go from ~${r(v1)} to ~${r(v2)} u/s (×√2). Anything already orbiting it is suddenly too slow and falls into tighter, more eccentric paths.`;
  if (target.kind === 'blackhole')
    t += ` Its horizon won't grow, though. Horizon size comes from radius here, not mass. More mass just means a harder pull.`;
  else if (target.kind === 'well') t += ` A well's pull stops at its ${r(target.influence)}u influence ring, so outside that nothing changes.`;
  else if (target.kind === 'star')
    t += ` It will also win more merges. If it collapses, its supernova power is 0.65 + mass/2,600 (capped at 1.8), and it leaves a core above 320 mass.`;
  else t += ` It will also win collisions against anything lighter than ${r(target.mass * 2)}, except black holes, which always win.`;
  return { mood: 'thinking', text: t };
}
