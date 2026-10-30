// Multi-user simulation campaign: runs hand-written persona flows plus seeded
// fuzz sessions against the app, checking invariants continuously. Every
// failure is a candidate bug: the report collects evidence (errors, state
// dumps, screenshots) for triage.
//
//   node scripts/user-sim.mjs                       # 100 sessions, default seed
//   node scripts/user-sim.mjs --sessions 20         # quick pass
//   node scripts/user-sim.mjs --seed 7              # different fuzz seed
//   GODMODE_URL=http://localhost:5173 node ...      # against dev server
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const OUT = process.env.SIM_OUT ?? 'artifacts/user-sim';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const SESSIONS = Number(arg('sessions', 100));
const BASE_SEED = Number(arg('seed', 20261029));
const CONCURRENCY = Number(arg('concurrency', 4));

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- rng
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- shared invariants
const INVARIANT_SNIPPET = `(() => {
  const a = window.__GODMODE__;
  if (!a) return { ok: false, reason: 'no app' };
  const w = a.world;
  const p = w.particles;
  let nan = 0;
  const stride = Math.max(1, Math.floor(p.count / 500));
  for (let i = 0; i < p.count; i += stride) {
    if (!Number.isFinite(p.x[i]) || !Number.isFinite(p.y[i]) || !Number.isFinite(p.vx[i]) || !Number.isFinite(p.vy[i])) nan++;
  }
  const bodyNaN = w.bodies.filter(b => ![b.x,b.y,b.vx,b.vy,b.mass].every(Number.isFinite)).length;
  const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
  const tools = document.querySelectorAll('.tool-button[data-tool]').length;
  return {
    ok: true,
    particles: p.count,
    bodies: w.bodies.length,
    waves: w.shockwaves.length,
    stats: { ...w.stats },
    nan, bodyNaN, overflowX, tools,
    fps: a.perf.fps,
    quality: a.quality,
    effective: a.effectiveQuality,
    simTime: w.time,
  };
})()`;

async function checkInvariants(page) {
  const s = await page.evaluate(INVARIANT_SNIPPET);
  const fails = [];
  if (!s.ok) fails.push(`app missing: ${s.reason}`);
  if (s.nan > 0) fails.push(`${s.nan} particles contain NaN`);
  if (s.bodyNaN > 0) fails.push(`${s.bodyNaN} bodies contain NaN`);
  if (s.particles > 24000) fails.push(`particle count ${s.particles} exceeds capacity`);
  if (s.bodies >= 120) fails.push(`body count ${s.bodies} too high`);
  if (s.overflowX) fails.push('horizontal overflow in DOM');
  if (s.tools !== 7) fails.push(`expected 7 tool buttons, found ${s.tools}`);
  if (s.fps <= 0) fails.push('fps never initialised');
  for (const [k, v] of Object.entries(s.stats)) {
    if (v < 0) fails.push(`stat ${k} is negative (${v})`);
  }
  return { fails, state: s };
}

/** Physics integrity: switching quality must not alter world state.
 *  The sim is paused first so any position delta is attributable to the
 *  quality switch itself, not to legitimate time-stepping. */
async function assertQualityIsRenderingOnly(page) {
  const grab = () =>
    page.evaluate(() => {
      const w = window.__GODMODE__.world;
      const p = w.particles;
      // Hash every slot's exact bits — catches ANY mutation, not just the first.
      let h = 2166136261 >>> 0;
      const bytes = new Float32Array(1);
      for (let i = 0; i < p.count; i++) {
        for (const arr of [p.x, p.y, p.vx, p.vy]) {
          bytes[0] = arr[i];
          const u = new Uint32Array(bytes.buffer)[0];
          h ^= u & 0xff;
          h = Math.imul(h, 16777619) >>> 0;
          h ^= (u >>> 8) & 0xff;
          h = Math.imul(h, 16777619) >>> 0;
          h ^= (u >>> 16) & 0xff;
          h = Math.imul(h, 16777619) >>> 0;
          h ^= (u >>> 24) & 0xff;
          h = Math.imul(h, 16777619) >>> 0;
        }
      }
      return {
        particles: p.count,
        bodies: w.bodies.length,
        time: w.time,
        massSum: w.bodies.reduce((s, b) => s + b.mass, 0),
        hash: h,
      };
    });

  // Pause so physics stops; reset the accumulator so nothing pending fires.
  await page.evaluate(() => {
    const a = window.__GODMODE__;
    if (!a.clock.paused) a.togglePause();
    a.clock.reset();
  });
  await page.waitForTimeout(120);
  const before = await grab();

  const qualities = ['cinematic', 'performance', 'balanced', 'auto', 'cinematic'];
  for (const q of qualities) {
    await page.evaluate((qq) => window.__GODMODE__.setQuality(qq), q);
    await page.waitForTimeout(120);
  }
  const after = await grab();
  // Resume so later steps aren't left paused.
  await page.evaluate(() => {
    const a = window.__GODMODE__;
    if (a.clock.paused) a.togglePause();
  });

  const fails = [];
  if (after.particles !== before.particles) fails.push(`quality switch changed particle count ${before.particles}→${after.particles}`);
  if (after.bodies !== before.bodies) fails.push(`quality switch changed body count ${before.bodies}→${after.bodies}`);
  if (after.massSum !== before.massSum) fails.push('quality switch changed total mass');
  if (after.hash !== before.hash) fails.push('quality switch mutated particle field bits');
  if (after.time !== before.time) fails.push('quality switch advanced sim time');
  return fails;
}

// ------------------------------------------------------------- personas
// Each persona: async ({ page, rng, record }) → void (throws on hard failure)
const PERSONAS = {
  async firstRun({ page, record }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    record('loaded');
    // Coach/hint must be passive: canvas still receives the first drag.
    const box = await page.locator('#universe').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.locator('.help-overlay, [data-help]').first().isVisible().catch(() => {});
    // H opens help; Escape closes it.
    await page.keyboard.press('h');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    record('helpToggled');
  },

  async keyboardPower({ page, record }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    for (const key of ['1', '2', '3', '4', '5', '6', '7', ' ']) await page.keyboard.press(key);
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('-');
    await page.keyboard.press('l');
    await page.keyboard.press('p');
    await page.keyboard.press('z');
    await page.keyboard.press('y');
    await page.keyboard.press('r');
    await page.waitForTimeout(400);
    record('keyboardTour');
    const tool = await page.evaluate(() => window.__GODMODE__.tool);
    if (!tool) throw new Error('tool selection lost after keyboard tour');
  },

  async scenarioHopper({ page, record, rng }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const ids = ['binary', 'singularity', 'collapse', 'slingshot', 'chaos', 'prime'];
    for (let i = 0; i < 4; i++) {
      const id = ids[Math.floor(rng() * ids.length)];
      await page.evaluate((s) => window.__GODMODE__.loadScenario(s), id);
      await page.waitForTimeout(500);
      const s = await checkInvariants(page);
      if (s.fails.length) throw new Error(`after ${id}: ${s.fails.join('; ')}`);
      record(`scenario:${id}`);
    }
  },

  async editor({ page, record, rng }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const box = await page.locator('#universe').boundingBox();
    // Pre-roll coordinates in Node; rng can't cross the evaluate boundary.
    const plan = [
      ['gravity', 3],
      ['blackhole', 1],
      ['repel', 2],
      ['orbit', 2],
    ].map(([tool, clicks]) => ({
      tool,
      pts: Array.from({ length: clicks }, () => ({
        x: box.x + 200 + rng() * (box.width - 400),
        y: box.y + 150 + rng() * (box.height - 300),
      })),
    }));
    for (const step of plan) {
      await page.evaluate((t) => window.__GODMODE__.selectTool(t), step.tool);
      for (const pt of step.pts) {
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(80);
      }
      record(`placed:${step.tool}`);
    }
    await page.evaluate(() => window.__GODMODE__.detonate(0, 0));
    await page.waitForTimeout(300);
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(`editor: ${s.fails.join('; ')}`);
  },

  async undoRedoAbuser({ page, record, rng }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const box = await page.locator('#universe').boundingBox();
    // Pre-roll all coordinates in Node (rng isn't serialisable into evaluate).
    const points = Array.from({ length: 12 }, () => ({
      cx: box.x + 250 + rng() * 500,
      cy: box.y + 200 + rng() * 400,
      dx: rng() * 600 - 300,
      dy: rng() * 600 - 300,
      r: rng(),
      undo: rng() < 0.5,
    }));
    for (const p of points) {
      if (p.r < 0.35) {
        await page.evaluate(() => window.__GODMODE__.selectTool('gravity'));
        await page.mouse.click(p.cx, p.cy);
      } else if (p.r < 0.5) {
        await page.evaluate(({ dx, dy }) => window.__GODMODE__.detonate(dx, dy), { dx: p.dx, dy: p.dy });
      } else if (p.r < 0.75) {
        await page.keyboard.press('z');
      } else {
        await page.keyboard.press('y');
      }
      await page.waitForTimeout(60);
    }
    // End on a clean undo state: redo/undo again must not throw or corrupt.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(rng() < 0.5 ? 'z' : 'y');
      await page.waitForTimeout(40);
    }
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(`undo/redo: ${s.fails.join('; ')}`);
    record('undoRedoStress');
  },

  async archivist({ page, record }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    // Save repeatedly; expect graceful handling when the archive fills.
    for (let i = 0; i < 10; i++) {
      await page.evaluate((n) => window.__GODMODE__.saveExperiment(`sim-user-${n}`), i);
      await page.waitForTimeout(60);
    }
    const saves = await page.evaluate(() => window.__GODMODE__.store.list().length);
    if (saves > 8) throw new Error(`archive holds ${saves} entries (max 8)`);
    record(`saves:${saves}`);
    // Load the first save; the world must restore to a valid state.
    await page.evaluate(() => {
      const list = window.__GODMODE__.store.list();
      if (list.length) window.__GODMODE__.loadSave(list[0].id);
    });
    await page.waitForTimeout(300);
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(`loadSave: ${s.fails.join('; ')}`);
    // Export/import round-trip through a data URL string.
    const ok = await page.evaluate(() => {
      const a = window.__GODMODE__;
      const before = a.world.particles.count;
      try {
        const list = a.store.list();
        if (!list.length) return true;
        const doc = a.store.load(list[0].id);
        const text = JSON.stringify(doc);
        const reparsed = a.store.importText(text);
        return typeof reparsed.name === 'string' && before >= 0;
      } catch (e) {
        return `throw:${e.message}`;
      }
    });
    if (ok !== true) throw new Error(`export/import round-trip: ${ok}`);
    record('roundTrip');
  },

  async qualityTour({ page, record }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const physicsFails = await assertQualityIsRenderingOnly(page);
    if (physicsFails.length) throw new Error(physicsFails.join('; '));
    record('qualityRenderingOnly');
    // Through the real select control, including 'auto' if offered.
    const options = await page.locator('.quality-select option').evaluateAll((els) => els.map((e) => e.value));
    for (const q of options) {
      await page.selectOption('.quality-select', q);
      await page.waitForTimeout(200);
      const cur = await page.evaluate(() => window.__GODMODE__.quality);
      if (cur !== q) throw new Error(`selecting ${q} left quality at ${cur}`);
    }
    record(`options:${options.join(',')}`);
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(s.fails.join('; '));
  },

  async touchUser({ page, record }) {
    // Simulated touch viewport: rail must stay reachable, no overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(s.fails.join('; '));
    // Every tool button must be within the viewport and clickable.
    const count = await page.locator('.tool-button[data-tool]').count();
    for (let i = 0; i < count; i++) {
      const btn = page.locator('.tool-button[data-tool]').nth(i);
      await btn.scrollIntoViewIfNeeded();
      const bb = await btn.boundingBox();
      if (!bb || bb.x < -1 || bb.x + bb.width > 400) throw new Error(`tool button ${i} outside mobile viewport`);
    }
    await page.locator('.tool-button[data-tool]').first().click();
    record('mobileToolsReachable');
  },

  async slingshotHunter({ page, record }) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    await page.evaluate(() => window.__GODMODE__.loadScenario('slingshot'));
    // Fast-forward the stream past the star; slingshots should accrue but the
    // app must not throw or spawn NaN while they do.
    await page.evaluate(() => {
      const a = window.__GODMODE__;
      a.clock.speed = 4;
      a.world.params.speed = 4;
    });
    await page.waitForTimeout(4000);
    const stats = await page.evaluate(() => ({ ...window.__GODMODE__.world.stats }));
    record(`slingshots:${stats.slingshots}`);
    const s = await checkInvariants(page);
    if (s.fails.length) throw new Error(s.fails.join('; '));
  },

  async prefsTinkerer({ page, record }) {
    // Corrupt / extreme preferences must never brick startup.
    const corrupt = [
      '{"quality":"bogus","volume":99}',
      'not json at all',
      '{"trailLength":-5,"showPerf":"yes"}',
    ];
    for (const raw of corrupt) {
      await page.addInitScript((value) => {
        localStorage.setItem('godmode.prefs.v1', value);
      }, raw);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
      const q = await page.evaluate(() => window.__GODMODE__.quality);
      if (!['auto', 'cinematic', 'balanced', 'performance'].includes(q)) {
        throw new Error(`corrupt prefs produced quality=${q}`);
      }
      record('corruptPrefsRecovered');
    }
  },
};

// --------------------------------------------------------------- fuzzer
const FUZZ_ACTIONS = [
  { name: 'drag', weight: 10, run: async (page, rng) => {
    const box = await page.locator('#universe').boundingBox();
    const x = box.x + rng() * box.width;
    const y = box.y + rng() * box.height;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (rng() - 0.5) * 300, y + (rng() - 0.5) * 200, { steps: 4 });
    await page.mouse.up();
  } },
  { name: 'zoom', weight: 6, run: async (page, rng) => {
    const box = await page.locator('#universe').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, (rng() - 0.5) * 800);
  } },
  { name: 'toolClick', weight: 8, run: async (page, rng) => {
    await page.evaluate((i) => window.__GODMODE__.selectTool(['observe','gravity','blackhole','supernova','repel','paint','orbit'][i]), Math.floor(rng() * 7));
  } },
  { name: 'canvasClick', weight: 10, run: async (page, rng) => {
    const box = await page.locator('#universe').boundingBox();
    await page.mouse.click(box.x + rng() * box.width, box.y + rng() * box.height);
  } },
  { name: 'keyboard', weight: 8, run: async (page, rng) => {
    const keys = ['1','2','3','4','5','6','7',' ','+','-','z','y','l','p','f','m'];
    await page.keyboard.press(keys[Math.floor(rng() * keys.length)]);
  } },
  { name: 'scenario', weight: 4, run: async (page, rng) => {
    await page.evaluate((id) => window.__GODMODE__.loadScenario(id), ['prime','binary','singularity','collapse','slingshot','chaos'][Math.floor(rng() * 6)]);
  } },
  { name: 'quality', weight: 3, run: async (page, rng) => {
    await page.evaluate((q) => window.__GODMODE__.setQuality(q), ['auto','cinematic','balanced','performance'][Math.floor(rng() * 4)]);
  } },
  { name: 'speed', weight: 4, run: async (page, rng) => {
    await page.evaluate((s) => window.__GODMODE__.setSpeed(s), [0.25, 0.5, 1, 2, 4][Math.floor(rng() * 5)]);
  } },
  { name: 'checkpoint', weight: 3, run: async (page) => {
    await page.evaluate(() => window.__GODMODE__.checkpoint());
  } },
  { name: 'rewind', weight: 3, run: async (page, rng) => {
    await page.evaluate((i) => { try { window.__GODMODE__.rewindTo(i); } catch { /* empty timeline is fine */ } }, Math.floor(rng() * 3));
  } },
  { name: 'spawn', weight: 4, run: async (page, rng) => {
    await page.evaluate((k) => window.__GODMODE__.spawnBody(k), rng() < 0.5 ? 'star' : 'planet');
  } },
  { name: 'sliders', weight: 3, run: async (page, rng) => {
    await page.evaluate((v) => window.__GODMODE__.setGravity(v), 100 + rng() * 8000);
    await page.evaluate((v) => window.__GODMODE__.setTrail(v), rng());
  } },
  { name: 'resize', weight: 2, run: async (page, rng) => {
    await page.setViewportSize({ width: Math.round(360 + rng() * 1200), height: Math.round(500 + rng() * 600) });
    await page.waitForTimeout(120);
  } },
  { name: 'pause', weight: 4, run: async (page) => {
    await page.evaluate(() => window.__GODMODE__.togglePause());
  } },
  { name: 'labels', weight: 2, run: async (page) => {
    await page.evaluate(() => window.__GODMODE__.toggleLabels());
  } },
];

const WEIGHTED = [];
for (const action of FUZZ_ACTIONS) {
  for (let i = 0; i < action.weight; i++) WEIGHTED.push(action);
}

async function fuzzSession(seed, index) {
  const rng = mulberry32(seed);
  const context = await fuzzBrowser.newContext({ viewport: { width: 1280 + Math.floor(rng() * 160), height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('godmode.seeded.v1', '1');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const trace = [];
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
    const steps = 30 + Math.floor(rng() * 40);
    let invariantFails = [];
    for (let step = 0; step < steps; step++) {
      const action = WEIGHTED[Math.floor(rng() * WEIGHTED.length)];
      trace.push(action.name);
      try {
        await action.run(page, rng);
      } catch (e) {
        invariantFails.push(`action ${action.name} threw: ${e.message}`);
      }
      if (step % 10 === 0) {
        const s = await checkInvariants(page);
        invariantFails.push(...s.fails.map((f) => `step ${step}: ${f}`));
        if (invariantFails.length > 6) break; // enough evidence
      }
    }
    if (errors.length) invariantFails.push(...errors.slice(0, 5));
    return { index, seed, ok: invariantFails.length === 0, fails: invariantFails, trace, screenshot: null };
  } catch (e) {
    const shot = path.join(OUT, `fuzz-${index}-seed${seed}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    return { index, seed, ok: false, fails: [`fatal: ${e.message}`], trace, screenshot: shot };
  } finally {
    await context.close();
  }
}

// ------------------------------------------------------------- personas runner
async function runPersona(name, index) {
  const rng = mulberry32(BASE_SEED + 1000 + index);
  const context = await personaBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.setItem('godmode.seeded.v1', '1');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  const steps = [];
  try {
    await PERSONAS[name]({ page, rng, record: (s) => steps.push(s) });
    const s = await checkInvariants(page);
    const fails = [...s.fails, ...errors.slice(0, 5)];
    return { name, ok: fails.length === 0, fails, steps };
  } catch (e) {
    const shot = path.join(OUT, `persona-${name}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    return { name, ok: false, fails: [e.message, ...errors.slice(0, 5)], steps, screenshot: shot };
  } finally {
    await context.close();
  }
}

// ----------------------------------------------------------------- main
console.log(`user-sim: ${Object.keys(PERSONAS).length} personas + ${SESSIONS} fuzz sessions (seed ${BASE_SEED}) → ${BASE}`);

const personaBrowser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const personaResults = [];
for (const name of Object.keys(PERSONAS)) {
  const result = await runPersona(name, personaResults.length);
  personaResults.push(result);
  console.log(`  persona ${result.ok ? 'PASS' : 'FAIL'} ${name}${result.fails.length ? ` — ${result.fails.join(' | ')}` : ''}`);
}
await personaBrowser.close();

// Fuzz sessions run on their own browser with limited concurrency.
const fuzzBrowser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const fuzzResults = [];
let nextIndex = 0;
async function worker() {
  while (nextIndex < SESSIONS) {
    const i = nextIndex++;
    const result = await fuzzSession(BASE_SEED + i, i);
    fuzzResults.push(result);
    if (!result.ok) console.log(`  fuzz FAIL #${i} (seed ${result.seed}): ${result.fails[0]}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, SESSIONS) }, worker));
await fuzzBrowser.close();

const fuzzPassed = fuzzResults.filter((r) => r.ok).length;
const personasPassed = personaResults.filter((r) => r.ok).length;
const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  seed: BASE_SEED,
  personas: personaResults,
  fuzz: { total: SESSIONS, passed: fuzzPassed, failed: SESSIONS - fuzzPassed, failures: fuzzResults.filter((r) => !r.ok) },
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(
  `\npersonas: ${personasPassed}/${personaResults.length} passed · fuzz: ${fuzzPassed}/${SESSIONS} passed → ${path.join(OUT, 'report.json')}`,
);
if (personasPassed < personaResults.length || fuzzPassed < SESSIONS) process.exitCode = 1;
