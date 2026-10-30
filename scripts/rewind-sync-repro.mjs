// Focused repro for the rewind-slider sync race found by user-acceptance
// Session D: timeline.keyframes is app state, but .rewind-slider#max is only
// refreshed by the throttled UI sync (>110ms). The check reads the DOM right
// after waitForFunction sees the 3rd keyframe — if the throttle window was
// closed in that frame, max lags at 1 (length 2) and the assertion fails.
//
//   GODMODE_URL=http://localhost:4173/ node scripts/rewind-sync-repro.mjs
// Reports per iteration: immediate-read outcome + convergence lag (how long
// the DOM takes to reach max>=2 after the page state crosses 3 keyframes).
import { chromium } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const ITER = Number(process.env.REPRO_ITER ?? 5);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let immediateFails = 0;
let maxLag = 0;
for (let i = 1; i <= ITER; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('godmode.prefs.v1', JSON.stringify({ volume: 0, muted: true, quality: 'balanced', trailLength: 0.55, showPerf: false, labels: true }));
    localStorage.setItem('godmode.seeded.v1', '1');
    sessionStorage.setItem('godmode.coach.v1', '1');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });

  // Mirror Session D's tail: sim paused → action-syncs on resume + speed
  // change close the throttle window, then keyframes must accumulate. If the
  // sim starts running (fresh load), pause first so the resume click has the
  // same phase relationship as the real suite.
  const pausedFirst = await page.locator('.transport-play.paused').count();
  if (!pausedFirst) await page.locator('.transport-play').click(); // pause
  await page.locator('.transport-play').click(); // resume (action sync)
  const chip = page.locator('.speed-chip').filter({ hasText: '4×' });
  if (await chip.count()) await chip.click(); // 4x (action sync)

  // Wait for the app state to reach 3 keyframes (what Session D waits on).
  const t0 = Date.now();
  await page.waitForFunction(() => window.__GODMODE__.timeline.keyframes.length >= 3, null, { timeout: 30000 });

  // Immediate DOM read — exactly what Session D asserts against.
  const immediate = Number(await page.locator('.rewind-slider').getAttribute('max'));

  // Convergence: how long until the DOM reflects >= 2?
  let lag = 0;
  if (immediate < 2) {
    const tConv = Date.now();
    try {
      await page.waitForFunction(
        () => Number(document.querySelector('.rewind-slider')?.getAttribute('max') ?? 0) >= 2,
        null,
        { timeout: 5000 },
      );
      lag = Date.now() - tConv;
    } catch {
      lag = -1; // never converged
    }
  }
  const wall = Date.now() - t0;
  const ok = immediate >= 2;
  if (!ok) immediateFails++;
  if (lag > maxLag) maxLag = lag;
  console.log(
    `iter ${i}: state>=3 keyframes after ${wall}ms · immediate DOM max=${immediate} ${ok ? 'PASS' : 'FAIL'} · DOM lag ${lag}ms${errors.length ? ` · ${errors.length} errors` : ''}`,
  );
  await ctx.close();
}

await browser.close();
console.log(`\n${BASE} — ${ITER} runs: immediate-read failures ${immediateFails}, worst DOM convergence lag ${maxLag}ms`);
if (immediateFails > 0) process.exitCode = 1;
