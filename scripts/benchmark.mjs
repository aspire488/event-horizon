// Honest frame-time benchmark on the REAL GPU (RTX 3050 via --use-angle=d3d11,
// same flags that probe-gpu.mjs verified). One fresh page per cell; production
// build via `vite preview`. Results land in artifacts/benchmark/*.json + a
// markdown table printed to stdout.
//
//   node scripts/benchmark.mjs                 # full matrix
//   BENCH_QUICK=1 node scripts/benchmark.mjs   # prime + singularity only
//   GODMODE_URL=... node scripts/benchmark.mjs # non-default target
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const OUT = process.env.BENCH_OUT ?? 'artifacts/benchmark';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const QUICK = process.env.BENCH_QUICK === '1';
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS ?? 6000);
const MEASURE_MS = Number(process.env.BENCH_MEASURE_MS ?? 15000);

const QUALITIES = process.env.BENCH_QUALITIES
  ? process.env.BENCH_QUALITIES.split(',')
  : QUICK
    ? ['cinematic', 'performance']
    : ['cinematic', 'balanced', 'performance', 'auto'];
const SCENARIOS = QUICK ? ['prime', 'singularity'] : ['prime', 'singularity', 'chaos'];

// App-independent frame sampler: measures real rAF cadence on ANY build
// (the baseline build predates perfStats), so baseline vs final compare like
// for like. Percentiles are computed in-page over the measurement window.
const SAMPLER = (measureMs) =>
  new Promise((resolve) => {
    const samples = [];
    let last = performance.now();
    let running = true;
    const tick = (now) => {
      if (!running) return;
      samples.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => {
      running = false;
      const sorted = [...samples].sort((a, b) => a - b);
      const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
      const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
      resolve({
        frames: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        worst: sorted[sorted.length - 1] ?? 0,
        mean,
        fps: mean > 0 ? 1000 / mean : 0,
      });
    }, measureMs);
  });

const GPU_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--mute-audio',
  '--enable-features=Vulkan',
  '--use-angle=d3d11',
  '--force-gpu-mem-available-mb=4096',
];

function gitInfo() {
  try {
    return {
      commit: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
      branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
      dirty: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0,
    };
  } catch {
    return { commit: 'unknown', branch: 'unknown', dirty: false };
  }
}

fs.mkdirSync(OUT, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const run = {
  runId,
  startedAt: new Date().toISOString(),
  base: BASE,
  settleMs: SETTLE_MS,
  measureMs: MEASURE_MS,
  viewport: { width: 1280, height: 800 },
  gpuArgs: GPU_ARGS.filter((a) => a.startsWith('--use-angle') || a.startsWith('--enable-features')),
  git: gitInfo(),
  cells: [],
};

console.log(`benchmark ${runId} → ${BASE}`);
console.log(`git ${run.git.commit} (${run.git.branch}${run.git.dirty ? ', dirty' : ''})`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GPU_ARGS });

let rendererString = 'unknown';

for (const quality of QUALITIES) {
  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript((q) => {
      localStorage.setItem(
        'godmode.prefs.v1',
        JSON.stringify({
          volume: 0,
          muted: true,
          quality: q,
          trailLength: 0.55,
          showPerf: false,
          labels: false,
        }),
      );
      localStorage.setItem('godmode.seeded.v1', '1');
    }, quality);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    const t0 = Date.now();
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__GODMODE__), null, { timeout: 30000 });
      await page.evaluate((id) => window.__GODMODE__.loadScenario(id), scenario);
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(() => window.__GODMODE__.perf?.resetSamples?.());
      const [frame, appStats] = await Promise.all([
        page.evaluate(SAMPLER, MEASURE_MS),
        page.evaluate(() => (window.__GODMODE__.perfStats ? window.__GODMODE__.perfStats() : null)).catch(() => null),
      ]);
      rendererString = appStats?.renderer ?? rendererString;
      const cell = {
        quality,
        scenario,
        fps: Number(frame.fps.toFixed(1)),
        p50: Number(frame.p50.toFixed(2)),
        p95: Number(frame.p95.toFixed(2)),
        p99: Number(frame.p99.toFixed(2)),
        worst: Number(frame.worst.toFixed(1)),
        frames: frame.frames,
        physicsMs: appStats ? Number(appStats.physicsMs.toFixed(2)) : null,
        renderMs: appStats ? Number(appStats.renderMs.toFixed(2)) : null,
        appFps: appStats ? Number(appStats.fps.toFixed(1)) : null,
        effectiveQuality: appStats?.effectiveQuality ?? quality,
        particles: appStats?.particles ?? null,
        bodies: appStats?.bodies ?? null,
        errors,
        wallMs: Date.now() - t0,
      };
      run.cells.push(cell);
      console.log(
        `  ${quality.padEnd(11)} ${scenario.padEnd(10)} fps=${cell.fps.toFixed(1).padStart(6)}  p95=${cell.p95.toFixed(1).padStart(6)}ms  p99=${cell.p99.toFixed(1).padStart(6)}ms${cell.physicsMs !== null ? `  phys=${cell.physicsMs}ms  draw=${cell.renderMs}ms` : ''}${errors.length ? `  ⚠ ${errors.length} errors` : ''}`,
      );
    } catch (error) {
      run.cells.push({ quality, scenario, fatal: String(error), errors });
      console.error(`  ${quality} ${scenario} FAILED: ${error}`);
    }
    await context.close();
  }
}

await browser.close();
run.renderer = rendererString;
run.finishedAt = new Date().toISOString();

const jsonPath = path.join(OUT, `benchmark-${runId}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(run, null, 2));

const md = [
  `Renderer: \`${rendererString}\` · GPU args: \`${run.gpuArgs.join(' ')}\` · settle ${SETTLE_MS}ms · measure ${MEASURE_MS}ms · viewport 1280×800`,
  ``,
  `| Quality | Scenario | FPS | P50 ms | P95 ms | P99 ms | Worst ms | Physics ms | Render ms | Tier used | Errors |`,
  `|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|`,
  ...run.cells
    .filter((c) => !c.fatal)
    .map(
      (c) =>
        `| ${c.quality} | ${c.scenario} | ${c.fps} | ${c.p50} | ${c.p95} | ${c.p99} | ${c.worst} | ${c.physicsMs ?? '—'} | ${c.renderMs ?? '—'} | ${c.effectiveQuality} | ${c.errors.length} |`,
    ),
].join('\n');
console.log(`\nrenderer: ${rendererString}\n`);
console.log(md);
fs.writeFileSync(path.join(OUT, `benchmark-${runId}.md`), md);
console.log(`\nwritten → ${jsonPath}`);
