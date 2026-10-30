import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true,
  args: ['--no-sandbox','--disable-dev-shm-usage','--mute-audio','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('godmode.prefs.v1', JSON.stringify({volume:0,muted:true,quality:'balanced',trailLength:0.55,showPerf:false,labels:true}));
  localStorage.setItem('godmode.seeded.v1','1');
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, { timeout: 30000 });
await page.evaluate(() => window.__GODMODE__.loadScenario('singularity'));
await page.waitForTimeout(4000);
await page.screenshot({ path: 'artifacts/final/singularity-1440x900.png' });
// close-up: zoom toward the hole
await page.evaluate(() => { const a = window.__GODMODE__; a.camera.snap(0, 0, 900); });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/final/singularity-closeup.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
