import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('No Chrome executable found. Set CHROME_PATH.');
  process.exit(2);
}

const failures = [];
const notes = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    notes.push(`PASS  ${name}  (${Date.now() - started} ms)`);
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
  ],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem(
    'godmode.prefs.v1',
    JSON.stringify({
      volume: 0,
      muted: true,
      quality: 'performance',
      trailLength: 0.55,
      showPerf: false,
      labels: true,
    }),
  );
  localStorage.setItem('godmode.seeded.v1', '1');
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const state = () =>
  page.evaluate(() => {
    const app = window.__GODMODE__;
    if (!app) throw new Error('App handle missing');
    const w = app.world;
    return {
      particles: w.particles.count,
      bodies: w.bodies.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, mass: b.mass })),
      time: w.time,
      paused: app.clock.paused,
      speed: app.clock.speed,
      tool: app.tool,
      activeScenario: app.activeScenario,
      stats: { ...w.stats },
      shockwaves: w.shockwaves.length,
      absorbed: w.stats.absorbedByBlackHole,
      calls: app.renderer.diagnostics().calls,
      fps: app.perf.fps,
      events: app.events.events.map((e) => e.kind),
      objectives: app.objectives.objectives.map((o) => ({ id: o.id, done: o.done, progress: o.progress })),
      eventMessages: app.events.events.map((event) => event.text),
      canvas: { w: app.renderer.renderer.domElement.width, h: app.renderer.renderer.domElement.height },
    };
  });

const waitReady = async () => {
  await page.waitForFunction(() => Boolean(window.__GODMODE__), null, { timeout: 20000 });
  await page.waitForFunction(() => window.__GODMODE__.perf.fps > 0, null, { timeout: 30000 });
  await page.waitForTimeout(600);
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await waitReady();

await check('the declared SVG favicon is served successfully', async () => {
  const iconUrl = new URL('favicon.svg', BASE).toString();
  const response = await page.request.get(iconUrl);
  assert.equal(response.status(), 200, `favicon response: ${response.status()}`);
  assert.match(await response.text(), /<svg\b/i, 'favicon response is not SVG');
});

await check('the application boots with a live universe', async () => {
  const s = await state();
  assert.ok(s.particles > 500, `expected particles, got ${s.particles}`);
  assert.ok(s.bodies.length >= 4, `expected bodies, got ${s.bodies.length}`);
  assert.ok(s.calls > 3, `renderer issued too few draw calls (${s.calls})`);
  assert.ok(s.canvas.w > 0 && s.canvas.h > 0, 'canvas has no drawing buffer');
  assert.ok(s.fps > 0, 'no frames measured');
  console.log(`      ${s.fps.toFixed(1)} fps (software WebGL) · ${s.particles} particles · ${s.calls} draw calls`);
});

await check('the canvas renders a non-empty scene', async () => {
  const shot = await page.screenshot();
  const png = PNG.sync.read(shot);
  let lit = 0;
  let total = 0;
  let sum = 0;
  for (let y = 150; y < 780; y += 3) {
    for (let x = 100; x < 1080; x += 3) {
      const idx = (png.width * y + x) << 2;
      const lum = png.data[idx] * 0.2126 + png.data[idx + 1] * 0.7152 + png.data[idx + 2] * 0.0722;
      total += 1;
      sum += lum;
      if (lum > 12) lit += 1;
    }
  }
  assert.ok(total > 1000, 'pixel sample failed');
  assert.ok(lit / total > 0.01, `scene looks black (${((lit / total) * 100).toFixed(2)}% lit)`);
  assert.ok(sum / total > 3, 'scene luminance is implausibly low');
});

await check('pause and resume control the simulation clock', async () => {
  await page.mouse.click(700, 300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const paused = await state();
  assert.equal(paused.paused, true);
  await page.waitForTimeout(500);
  const still = await state();
  assert.ok(Math.abs(still.time - paused.time) < 0.02, `time advanced while paused: ${paused.time} -> ${still.time}`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const resumed = await state();
  assert.ok(resumed.time > still.time + 0.1, 'time did not resume');
  assert.equal(resumed.paused, false);
});

await check('a gravity well bends a particle trajectory', async () => {
  await page.evaluate(() => {
    const app = window.__GODMODE__;
    app.clock.paused = true;
    const w = app.world;
    w.bodies = w.bodies.filter((b) => b.kind === 'star').slice(0, 1);
    w.shockwaves.length = 0;
    const p = w.particles;
    p.count = 1;
    p.x[0] = 400;
    p.y[0] = 0;
    p.z[0] = 0;
    p.vx[0] = 0;
    p.vy[0] = 0;
    p.life[0] = 999;
    p.maxLife[0] = 999;
    p.size[0] = 4;
    p.pal[0] = 0;
    p.seed[0] = 0.5;
    p.type[0] = 1;
    p.shockTag[0] = 0;
    p.flags[0] = 0;
  });
  await page.waitForTimeout(120);
  await page.locator('.tool-button[data-tool="gravity"]').click();
  const point = await page.evaluate(() => {
    const app = window.__GODMODE__;
    return app.renderer.worldToScreen(400, 260);
  });
  await page.mouse.click(point.x, point.y);
  const placed = await page.evaluate(() => {
    const app = window.__GODMODE__;
    return app.world.bodies.some((b) => b.kind === 'well');
  });
  assert.ok(placed, 'gravity tool did not create a well');
  await page.evaluate(() => {
    window.__GODMODE__.clock.paused = false;
  });
  await page.waitForTimeout(900);
  const result = await page.evaluate(() => {
    const app = window.__GODMODE__;
    const p = app.world.particles;
    const well = app.world.bodies.find((b) => b.kind === 'well');
    return {
      x: p.x[0],
      y: p.y[0],
      vy: p.vy[0],
      well: well ? { x: well.x, y: well.y } : null,
      count: p.count,
    };
  });
  assert.ok(result.well, 'well disappeared');
  assert.ok(result.vy > 2, `particle did not accelerate toward the well (vy=${result.vy})`);
  assert.ok(result.y > 1, 'particle did not move toward the well');
  assert.ok(result.count === 1, 'test particle was unexpectedly destroyed');
});

await check('a black hole absorbs matter', async () => {
  await page.evaluate(() => window.__GODMODE__.loadScenario('prime'));
  await page.waitForTimeout(600);
  await page.locator('.tool-button[data-tool="blackhole"]').click();
  const before = await state();
  // Press once to open the singularity, then drag it through the disc.
  await page.mouse.move(720, 440);
  await page.mouse.down();
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(720 + i * 18, 440 - Math.sin(i / 3) * 30);
  }
  await page.mouse.up();
  await page.waitForTimeout(1800);
  const after = await state();
  assert.ok(after.bodies.some((b) => b.kind === 'blackhole'), 'black hole was not created');
  assert.ok(after.absorbed > 0, 'black hole absorbed no particles');
  assert.ok(after.particles < before.particles, 'particle count did not fall');
  assert.ok(after.events.includes('blackhole') || after.events.includes('merge'), 'no black-hole event logged');
});

await check('a supernova emits a shockwave that moves matter', async () => {
  await page.evaluate(() => window.__GODMODE__.loadScenario('prime'));
  await page.waitForTimeout(600);
  await page.locator('.tool-button[data-tool="supernova"]').click();
  const before = await state();
  await page.mouse.click(760, 360);
  await page.waitForTimeout(120);
  const mid = await state();
  assert.ok(mid.shockwaves > 0, 'no shockwave was created');
  await page.waitForTimeout(900);
  const after = await state();
  assert.ok(after.stats.supernovas >= 1, 'supernova not counted');
  assert.ok(after.stats.shockedParticles > 0, 'shockwave swept no particles');
  assert.ok(after.particles > before.particles, 'supernova did not eject matter');
  assert.ok(after.events.includes('supernova'), 'no supernova event logged');
});

await check('scenarios load distinct states through the interface', async () => {
  await page.locator('.tab-button', { hasText: 'WORLDS' }).click();
  await page.locator('.scenario-row', { hasText: 'BINARY DANCE' }).locator('button').click();
  await page.waitForTimeout(500);
  const binary = await state();
  assert.equal(binary.activeScenario, 'binary');
  assert.ok(binary.bodies.filter((b) => b.kind === 'star').length >= 2, 'binary scenario lacks two stars');
  assert.ok(!binary.bodies.some((b) => b.kind === 'blackhole'), 'binary scenario should have no black hole');

  await page.locator('.scenario-row', { hasText: 'THE HUNGRY SINGULARITY' }).locator('button').click();
  await page.waitForTimeout(500);
  const singularity = await state();
  assert.equal(singularity.activeScenario, 'singularity');
  assert.ok(singularity.bodies.some((b) => b.kind === 'blackhole'), 'singularity scenario lacks a black hole');
});

await check('undo and redo restore object edits', async () => {
  await page.locator('.tab-button', { hasText: 'LAB' }).click();
  const before = await state();
  await page.getByRole('button', { name: 'SPAWN STAR' }).click();
  await page.waitForTimeout(200);
  const added = await state();
  assert.equal(added.bodies.length, before.bodies.length + 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = await state();
  assert.equal(undone.bodies.length, before.bodies.length, 'undo did not remove the spawned star');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  const redone = await state();
  assert.equal(redone.bodies.length, before.bodies.length + 1, 'redo did not restore the star');
});

await check('painting matter and launching an orbit work', async () => {
  const before = await state();
  await page.locator('.tool-button[data-tool="paint"]').click();
  await page.mouse.move(450, 550);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(450 + i * 18, 550 + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const painted = await state();
  assert.ok(
    painted.stats.emitted > before.stats.emitted,
    'paint did not emit matter according to simulation stats',
  );
  assert.ok(painted.particles > 0, 'paint left no particles in the field');

  await page.locator('.tool-button[data-tool="orbit"]').click();
  await page.mouse.click(950, 520);
  await page.waitForTimeout(500);
  const orbit = await state();
  assert.ok(orbit.bodies.some((b) => b.kind === 'planet'), 'orbit tool created no planet');
  const speed = await page.evaluate(() => {
    const app = window.__GODMODE__;
    const planet = [...app.world.bodies].reverse().find((b) => b.kind === 'planet');
    return planet ? Math.hypot(planet.vx, planet.vy) : 0;
  });
  assert.ok(speed > 1, `orbiting planet has no orbital velocity (${speed})`);
});

await check('reset rebuilds the scenario and undo restores the previous universe', async () => {
  await page.evaluate(() => window.__GODMODE__.setGravity(5000));
  await page.waitForTimeout(200);
  await page.locator('.transport-reset').click();
  await page.waitForTimeout(500);
  const reset = await state();
  assert.ok(reset.time < 2, `simulation time did not reset (${reset.time})`);
  assert.ok(reset.particles > 500, 'reset produced an empty universe');
  const gravity = await page.evaluate(() => window.__GODMODE__.world.params.gravity);
  assert.equal(gravity, 3000, 'reset did not restore the default gravitational constant');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => window.__GODMODE__.world.params.gravity);
  assert.equal(restored, 5000, 'undo did not restore the pre-reset universe');
  await page.evaluate(() => window.__GODMODE__.setGravity(3000));
});

await check('experiments save locally and survive a reload', async () => {
  await page.locator('.tab-button', { hasText: 'ARCHIVE' }).click();
  await page.locator('.save-row input').fill('Smoke Field');
  await page.getByRole('button', { name: 'SAVE' }).click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('godmode.saves.v1');
    return raw ? JSON.parse(raw).map((r) => r.name) : [];
  });
  assert.ok(saved.includes('Smoke Field'), 'experiment was not written to local storage');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady();
  await page.locator('.tab-button', { hasText: 'ARCHIVE' }).click();
  await page.waitForTimeout(300);
  const text = await page.locator('.panel-body').innerText();
  assert.ok(text.includes('Smoke Field'), 'saved experiment missing after reload');
  await page.locator('.save-item', { hasText: 'Smoke Field' }).getByRole('button', { name: 'LOAD' }).click();
  await page.waitForTimeout(500);
  const loaded = await state();
  assert.equal(loaded.activeScenario, 'custom');
  assert.ok(loaded.particles > 100, 'loaded experiment has no matter');
});

await check('JSON export and import round-trip through the UI', async () => {
  await page.locator('.tab-button', { hasText: 'ARCHIVE' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'EXPORT CURRENT' }).click(),
  ]);
  const filePath = path.join(process.cwd(), 'scripts', 'tmp-export.json');
  await download.saveAs(filePath);
  const json = fs.readFileSync(filePath, 'utf8');
  assert.ok(json.length > 1000, 'exported file is too small');
  assert.equal(JSON.parse(json).schema, 1);

  await page.setInputFiles('.hidden-input', filePath);
  await page.waitForFunction(
    () => window.__GODMODE__.events.events.some((e) => e.text.startsWith('Imported experiment')),
    null,
    { timeout: 8000 },
  );
  const stateAfter = await state();
  assert.equal(stateAfter.activeScenario, 'custom');
  assert.ok(stateAfter.particles > 100);
  assert.ok(
    stateAfter.eventMessages.some((message) => message.startsWith('Imported experiment')),
    `import completion event missing: ${stateAfter.eventMessages.join(' | ')}`,
  );

  const badPath = path.join(process.cwd(), 'scripts', 'tmp-invalid.json');
  fs.writeFileSync(badPath, JSON.stringify({ app: 'god-mode', schema: 1, world: { particles: { count: 5, data: '' } } }));
  await page.evaluate(() => {
    window.__GODMODE__.clock.paused = true;
  });
  const beforeBad = await state();
  await page.setInputFiles('.hidden-input', badPath);
  await page.waitForTimeout(700);
  const warn = await page.locator('.toast').last().innerText();
  assert.match(warn, /Import failed|truncated|corrupt/i, `invalid import was not rejected: ${warn}`);
  const afterBad = await state();
  assert.equal(afterBad.particles, beforeBad.particles, 'invalid import changed the particle count');
  assert.equal(afterBad.activeScenario, beforeBad.activeScenario, 'invalid import changed the scenario');
  await page.evaluate(() => {
    window.__GODMODE__.clock.paused = false;
  });
  fs.rmSync(filePath, { force: true });
  fs.rmSync(badPath, { force: true });
});

await check('the performance readout reports engine measurements', async () => {
  await page.locator('.icon-button[title^="Performance"]').click();
  await page.waitForTimeout(500);
  const panel = page.locator('.perf-panel');
  assert.ok(await panel.isVisible(), 'performance panel is not visible');
  const text = await panel.innerText();
  assert.match(text, /FPS/i);
  const fpsText = await page.locator('.perf-cell b').first().innerText();
  assert.match(fpsText, /\d/, `FPS readout is not a number: ${fpsText}`);
  await page.locator('.icon-button[title^="Performance"]').click();
});

await check('help overlay, labels and hide-interface controls work', async () => {
  await page.locator('.icon-button[title^="Shortcuts"]').click();
  assert.ok(await page.locator('.help-overlay').isVisible(), 'help overlay did not open');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('.help-overlay').isHidden(), 'help overlay did not close');
  assert.ok((await page.locator('.body-label').count()) > 0, 'no body labels rendered');
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.show-ui').isVisible(), 'hidden UI has no restore control');
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('.transport').isVisible(), 'interface did not return');
});

await check('the layout stays usable on laptop and narrow screens', async () => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(500);
  const desktop = await page.evaluate(() => {
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const transport = document.querySelector('.transport').getBoundingClientRect();
    const rail = document.querySelector('.toolrail').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      panelRight: panel.right,
      panelTop: panel.top,
      transportBottom: transport.bottom,
      transportRight: transport.right,
      railLeft: rail.left,
      canvas: { w: document.querySelector('canvas').width, h: document.querySelector('canvas').height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  assert.ok(desktop.overflow <= 1, `page overflows horizontally by ${desktop.overflow}px`);
  assert.ok(desktop.panelRight <= desktop.viewport.w + 1, 'panel extends past the viewport');
  assert.ok(desktop.transportRight <= desktop.viewport.w + 1, 'transport extends past the viewport');
  assert.ok(desktop.transportBottom <= desktop.viewport.h + 1, 'transport extends below the viewport');
  assert.ok(desktop.railLeft >= 0, 'tool rail is off screen');
  assert.ok(desktop.canvas.w > 0 && desktop.canvas.h > 0, 'canvas lost its drawing buffer on resize');

  await page.setViewportSize({ width: 820, height: 720 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady();
  assert.ok(await page.locator('.panel-toggle').isVisible(), 'narrow layout has no panel toggle');
  assert.ok(!(await page.locator('.panel').isVisible()), 'panel should start closed on a narrow screen');
  await page.locator('.panel-toggle').click();
  await page.waitForTimeout(250);
  assert.ok(await page.locator('.panel').isVisible(), 'panel toggle did not open the panel');
  const narrow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    railBottom: document.querySelector('.toolrail').getBoundingClientRect().bottom,
    transportTop: document.querySelector('.transport').getBoundingClientRect().top,
  }));
  assert.ok(narrow.overflow <= 1, `narrow page overflows by ${narrow.overflow}px`);
  assert.ok(narrow.railBottom <= narrow.transportTop + 1, 'tool rail overlaps the transport bar');
});

await check('a first-time visitor gets sample experiments and a hint', async () => {
  const freshContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await freshContext.addInitScript(() => {
    localStorage.setItem(
      'godmode.prefs.v1',
      JSON.stringify({ volume: 0, muted: true, quality: 'performance', trailLength: 0.55, showPerf: false, labels: true }),
    );
  });
  const fresh = await freshContext.newPage();
  const freshErrors = [];
  fresh.on('pageerror', (error) => freshErrors.push(error.message));
  await fresh.goto(BASE, { waitUntil: 'domcontentloaded' });
  await fresh.waitForFunction(
    () => window.__GODMODE__ && window.__GODMODE__.store.size >= 2,
    null,
    { timeout: 30000 },
  );
  const info = await fresh.evaluate(() => ({
    names: window.__GODMODE__.store.list().map((s) => s.name),
    seeded: localStorage.getItem('godmode.seeded.v1'),
    particles: window.__GODMODE__.world.particles.count,
    hint: document.querySelector('.hint')?.textContent ?? '',
    savesVisible: document.querySelectorAll('.save-item').length,
  }));
  assert.ok(info.names.some((name) => name.includes('Sample')), 'sample experiments were not seeded');
  assert.equal(info.seeded, '1');
  assert.ok(info.particles > 500, 'first run has no matter');
  assert.ok(info.hint.length > 10, 'first run shows no interaction hint');
  assert.deepEqual(freshErrors, [], `fresh page errors: ${freshErrors.join(' | ')}`);
  await freshContext.close();
});

await check('no critical runtime errors were logged', async () => {
  const fatal = consoleErrors.filter(
    (text) => !/favicon|Failed to load resource.*404/i.test(text),
  );
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(fatal, [], `console errors: ${fatal.join(' | ')}`);
  assert.ok(pageErrors.length === 0, 'unexpected page errors');
});

const summary = {
  base: BASE,
  passed: notes.length,
  failed: failures.length,
  failures,
  notes,
};
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'smoke-report.json'), JSON.stringify(summary, null, 2));
console.log(`\n${notes.length} checks passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log(failures.join('\n'));
}
await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
