// Captures baseline screenshots of the production preview at the four target
// viewports. Deterministic: fixed seed scenario, fixed warm-up, muted audio.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const OUT = process.env.CAPTURE_OUT ?? 'artifacts/baseline';
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1280x800', width: 1280, height: 800 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'mobile-390x844', width: 390, height: 844 },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
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

const report = { capturedAt: new Date().toISOString(), base: BASE, viewports: [] };

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  await context.addInitScript(() => {
    localStorage.setItem(
      'godmode.prefs.v1',
      JSON.stringify({
        volume: 0,
        muted: true,
        quality: 'balanced',
        trailLength: 0.55,
        showPerf: false,
        labels: true,
      }),
    );
    localStorage.setItem('godmode.seeded.v1', '1');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__GODMODE__), null, { timeout: 20000 });
  await page.waitForTimeout(2500); // let the universe settle and twinkle animate
  const file = path.join(OUT, `${vp.name}.png`);
  await page.screenshot({ path: file });
  report.viewports.push({ ...vp, file, errors });
  console.log(`captured ${vp.name} (${errors.length} console errors)`);
  await context.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(report, null, 2));
console.log(`done -> ${OUT}`);
