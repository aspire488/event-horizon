// Browser checks for Orbito against a running build (npm run build && npm run preview).
//   node scripts/orbito-check.mjs                 # Chrome
//   ORBITO_BROWSER=firefox node scripts/orbito-check.mjs   # Playwright Firefox / webkit
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const ENGINE = process.env.ORBITO_BROWSER ?? 'chrome';
const OUT = process.env.ORBITO_OUT ?? 'artifacts/orbito';
const executablePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));
if (ENGINE === 'chrome' && !executablePath) {
  console.error('No Chrome executable found. Set CHROME_PATH.');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

// Firefox and WebKit use Playwright's own builds (npx playwright-core install firefox webkit).
const browser =
  ENGINE === 'chrome'
    ? await chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
      })
    : await { firefox, webkit }[ENGINE].launch({ headless: true });
console.log(`engine: ${ENGINE} ${browser.version()}`);

async function open(viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    localStorage.setItem('godmode.prefs.v1', JSON.stringify({ volume: 0, muted: true, quality: 'performance', trailLength: 0.55, showPerf: false, labels: true }));
    // Not a first session: skip the intro bubble so timing is deterministic.
    localStorage.setItem('godmode.orbito.v1', JSON.stringify({ memory: { sessions: 3, holes: 0, novas: 0, merges: 0, discoveries: 0 }, voice: false, quiet: false }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.waitForFunction(() => Boolean(window.__GODMODE__) && document.querySelector('.orbito'), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { page, context, errors };
}

const rect = (page, sel) =>
  page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }, sel);
const overlaps = (a, b) => a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

// ------------------------------------------------------------- desktop
{
  const { page, context, errors } = await open({ width: 1440, height: 900 });

  await check('creature renders bottom-left without covering controls', async () => {
    const o = await rect(page, '.orbito-creature');
    assert.ok(o && o.w > 40, 'creature missing');
    for (const sel of ['.toolrail', '.transport', '.panel', '.topbar']) {
      assert.ok(!overlaps(o, await rect(page, sel)), `creature overlaps ${sel}`);
    }
  });

  await check('exactly one event subscription', async () => {
    const n = await page.evaluate(() => window.__GODMODE__.events.listeners.size);
    assert.equal(n, 1);
  });

  await check('reacts to a real black hole event', async () => {
    // Pause first so no simulation event (slingshot, discovery) can override
    // the reaction on slower engines.
    await page.evaluate(() => window.__GODMODE__.togglePause());
    await page.waitForTimeout(250);
    const id = await page.evaluate(() => window.__GODMODE__.placeSource('blackhole', 600, 400));
    assert.ok(id, 'black hole not placed');
    const state = await page.evaluate(() => ({
      mood: document.querySelector('.orbito').dataset.mood,
      bubble: document.querySelector('.orbito-bubble').textContent,
      shown: document.querySelector('.orbito-bubble').classList.contains('show'),
    }));
    assert.equal(state.mood, 'surprised');
    assert.ok(state.shown && state.bubble.length > 10, 'no speech bubble');
    await page.screenshot({ path: `${OUT}/desktop-reaction.png` });
    await page.evaluate(() => window.__GODMODE__.togglePause());
  });

  await check('opens with click, focuses input, panel clear of rail/transport', async () => {
    await page.click('.orbito-creature');
    assert.equal(await page.getAttribute('.orbito-creature', 'aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'orbito-input');
    const p = await rect(page, '.orbito-panel');
    for (const sel of ['.toolrail', '.transport', '.panel']) assert.ok(!overlaps(p, await rect(page, sel)), `panel overlaps ${sel}`);
    assert.ok(p.y >= 0 && p.r <= 1440, 'panel off-screen');
  });

  await check('typing in Orbito does not trigger simulation shortcuts', async () => {
    const before = await page.evaluate(() => ({ tool: window.__GODMODE__.tool, paused: window.__GODMODE__.clock.paused }));
    await page.keyboard.type('3 r h ');
    const after = await page.evaluate(() => ({
      tool: window.__GODMODE__.tool,
      paused: window.__GODMODE__.clock.paused,
      collapsed: window.__GODMODE__.ui.isCollapsed,
      value: document.querySelector('.orbito-input').value,
    }));
    assert.equal(after.tool, before.tool);
    assert.equal(after.paused, before.paused);
    assert.equal(after.collapsed, false);
    assert.equal(after.value, '3 r h ');
    await page.fill('.orbito-input', '');
  });

  await check('answers with live context', async () => {
    await page.fill('.orbito-input', "what's happening?");
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.orbito-msg-orbito').length >= 2, null, { timeout: 4000 });
    const reply = await page.evaluate(() => [...document.querySelectorAll('.orbito-msg-orbito .orbito-text')].pop().textContent);
    const scenario = await page.evaluate(() => document.querySelector('.scenario-name')?.textContent ?? 'Prime Field');
    assert.match(reply, /Prime Field/i, `reply lacks scenario (${scenario}): ${reply}`);
    assert.match(reply, /black hole/, 'reply ignores the black hole just created');
    await page.screenshot({ path: `${OUT}/desktop-conversation.png` });
  });

  await check('starter chip asks a question', async () => {
    const n = await page.evaluate(() => document.querySelectorAll('.orbito-msg').length);
    await page.click('.orbito-chip >> nth=1');
    await page.waitForFunction((k) => document.querySelectorAll('.orbito-msg').length >= k + 2, n, { timeout: 4000 });
  });

  await check('message history stays bounded', async () => {
    for (let i = 0; i < 26; i++) {
      await page.fill('.orbito-input', `joke ${i}`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(900);
    const count = await page.evaluate(() => document.querySelectorAll('.orbito-msg').length);
    assert.ok(count <= 40, `messages ${count}`);
  });

  await check('Escape closes and returns focus to Orbito; shortcuts work again', async () => {
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('.orbito-creature', 'aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'orbito-creature');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('4');
    assert.equal(await page.evaluate(() => window.__GODMODE__.tool), 'supernova');
  });

  await check('keyboard: Enter on the creature opens the conversation', async () => {
    await page.focus('.orbito-creature');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('.orbito-creature', 'aria-expanded'), 'true');
    await page.keyboard.press('Escape');
  });

  await check('pause relaxes Orbito, H hides it with the interface', async () => {
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector('.orbito').dataset.mood), 'idle');
    await page.keyboard.press('Space');
    await page.keyboard.press('h');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.orbito')).display), 'none');
    await page.keyboard.press('h');
    await page.waitForTimeout(250);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.orbito')).display), 'none');
  });

  await check('reset is noticed with the new scenario name', async () => {
    await page.evaluate(() => window.__GODMODE__.loadScenario('binary'));
    await page.waitForTimeout(200);
    const text = await page.evaluate(() => document.querySelector('.orbito-bubble').textContent);
    assert.match(text, /Binary Dance/);
  });

  await check('no console errors on desktop', async () => assert.deepEqual(errors, []));
  await context.close();
}

// ------------------------------------------------------------- mobile
{
  const { page, context, errors } = await open({ width: 390, height: 844 });

  await check('mobile: creature clear of tool strip and transport', async () => {
    const o = await rect(page, '.orbito-creature');
    for (const sel of ['.toolrail', '.transport', '.topbar']) assert.ok(!overlaps(o, await rect(page, sel)), `overlaps ${sel}`);
  });

  await check('mobile: panel fits viewport, no horizontal scroll, Force Lab closed', async () => {
    await page.click('.orbito-creature');
    const p = await rect(page, '.orbito-panel');
    assert.ok(p.x >= 0 && p.r <= 390 && p.y >= 44, `panel ${JSON.stringify(p)}`);
    for (const sel of ['.toolrail', '.transport']) assert.ok(!overlaps(p, await rect(page, sel)), `panel overlaps ${sel}`);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 390, `scrollWidth ${scroll}`);
    const labOpen = await page.evaluate(() => document.querySelector('.panel')?.classList.contains('panel-open'));
    assert.ok(!labOpen, 'Force Lab still open under Orbito');
    await page.screenshot({ path: `${OUT}/mobile-conversation.png` });
  });

  await check('no console errors on mobile', async () => assert.deepEqual(errors, []));
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall Orbito browser checks passed');
process.exit(failures.length ? 1 : 0);
