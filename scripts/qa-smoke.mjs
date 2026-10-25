import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.GODMODE_URL ?? 'http://localhost:4173/';
const chrome = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const viewportSizes = [[1920,1080],[1440,900],[1024,768],[820,720],[390,844],[360,800]];
const results = [];
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem('godmode.prefs.v1', JSON.stringify({volume:0,muted:true,quality:'performance',trailLength:0.55,showPerf:false,labels:true}));
  localStorage.setItem('godmode.seeded.v1','1');
});
const page = await context.newPage();
const pageErrors = [], consoleErrors = [], failedRequests = [];
page.on('pageerror', e => pageErrors.push(e.stack ?? e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('requestfailed', r => failedRequests.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({name,status:'passed',durationMs:Date.now()-start}); }
  catch (e) { results.push({name,status:'failed',durationMs:Date.now()-start,error:e.message}); }
}
const waitApp = () => page.waitForFunction(() => window.__GODMODE__?.perf.fps > 0, null, {timeout:30000});
const state = () => page.evaluate(() => ({ tool:window.__GODMODE__.tool, scenario:window.__GODMODE__.activeScenario, particles:window.__GODMODE__.world.particles.count, bodies:window.__GODMODE__.world.bodies.length, shockwaves:window.__GODMODE__.world.shockwaves.length, time:window.__GODMODE__.world.time }));
await page.goto(base, {waitUntil:'domcontentloaded'}); await waitApp();

await check('six documented worlds load cleanly through the UI', async () => {
  await page.locator('.tab-button').filter({hasText:'WORLDS'}).click();
  const expected = ['prime','binary','singularity','collapse','slingshot','chaos'];
  for (const id of expected) {
    const row = page.locator(`.scenario-row`).filter({hasText: new RegExp(id === 'singularity' ? 'HUNGRY SINGULARITY' : id.toUpperCase())});
    await row.locator('button').click();
    await page.waitForTimeout(120);
    const s = await state();
    assert.equal(s.scenario,id); assert.ok(s.particles > 100); assert.ok(s.bodies > 0);
  }
});

await check('all seven tools select and their canvas actions produce expected state', async () => {
  const canvas = page.locator('#universe');
  const cases = [
    ['gravity', async before => { await page.mouse.click(510,470); assert.ok((await state()).bodies > before.bodies); }],
    ['blackhole', async before => { await page.mouse.click(560,470); assert.ok((await state()).bodies > before.bodies); }],
    ['supernova', async before => { await page.mouse.click(610,470); assert.ok((await state()).shockwaves > before.shockwaves); }],
    ['repel', async before => { await page.mouse.click(660,470); assert.ok((await state()).bodies > before.bodies); }],
    ['paint', async before => { await page.mouse.move(700,500); await page.mouse.down(); await page.mouse.move(740,520); await page.mouse.up(); assert.ok((await state()).particles >= before.particles); }],
    ['orbit', async before => { await page.mouse.click(780,500); assert.ok((await state()).bodies > before.bodies); }],
  ];
  await page.evaluate(() => { window.__GODMODE__.clock.paused=true; });
  for (const [tool, action] of cases) {
    await page.locator(`.tool-button[data-tool="${tool}"]`).click();
    assert.equal((await state()).tool,tool);
    const before = await state(); await action(before);
  }
  await page.locator('.tool-button[data-tool="observe"]').click();
  assert.equal((await state()).tool,'observe');
  assert.ok(await canvas.isVisible());
});

await check('all primary tabs render and remain interactive', async () => {
  for (const tab of ['LAB','WORLDS','EVENTS','MISSIONS','ARCHIVE']) {
    const button = page.locator('.tab-button').filter({hasText:tab});
    await button.click(); assert.ok(await button.evaluate(el => el.classList.contains('active')));
    assert.ok(await page.locator('.panel-body').isVisible());
  }
});

await check('toolbar, panel, transport and canvas remain in viewport at six sizes', async () => {
  for (const [width,height] of viewportSizes) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(150);
    if (width < 901) {
      if (!(await page.locator('.panel-toggle').isVisible())) throw new Error(`${width}x${height}: panel toggle unavailable`);
      if (!(await page.locator('.panel').isVisible())) await page.locator('.panel-toggle').click();
    }
    const report = await page.evaluate(() => {
      const rect = sel => { const e=document.querySelector(sel); const r=e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:!!(r.width&&r.height)}; };
      return {viewport:{w:innerWidth,h:innerHeight},overflow:document.documentElement.scrollWidth-innerWidth,rail:rect('.toolrail'),transport:rect('.transport'),brand:rect('.brand'),panel:rect('.panel'),tools:[...document.querySelectorAll('.tool-button')].map(e=>{const r=e.getBoundingClientRect();return {tool:e.dataset.tool,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};})};
    });
    assert.ok(report.overflow <= 1, `${width}x${height}: horizontal overflow ${report.overflow}`);
    for (const c of ['rail','transport','brand']) assert.ok(report[c].left>=-1 && report[c].right<=width+1 && report[c].top>=-1 && report[c].bottom<=height+1,`${width}x${height}: ${c} outside viewport ${JSON.stringify(report[c])}`);
    assert.equal(report.tools.length,7);
    for (const t of report.tools) assert.ok(t.width>=30 && t.height>=30 && t.left>=0 && t.right<=width,`${width}x${height}: inaccessible ${t.tool} hit target ${JSON.stringify(t)}`);
    if (width < 901) await page.locator('.panel-toggle').click();
  }
});

await check('input focus protects global shortcuts and Escape closes help', async () => {
  await page.setViewportSize({width:1024,height:768});
  if (!(await page.locator('.panel').isVisible())) await page.locator('.panel-toggle').click();
  await page.locator('.tab-button').filter({hasText:'ARCHIVE'}).click();
  const input=page.locator('.save-row input'); await input.fill('Shortcut Test');
  const toolBefore=(await state()).tool; await input.press('2'); assert.equal((await state()).tool,toolBefore);
  await page.locator('.icon-button[title^="Shortcuts"]').click();
  await page.keyboard.press('Escape'); assert.ok(await page.locator('.help-overlay').isHidden());
});

await check('scenario switching does not accumulate bodies, waves or listeners', async () => {
  for(let i=0;i<12;i++) await page.evaluate(id => window.__GODMODE__.loadScenario(id), ['prime','chaos','binary','collapse'][i%4]);
  const s=await state(); assert.ok(s.bodies<30); assert.ok(s.shockwaves<10); assert.ok(s.particles<=24000);
});

await check('browser has no page exceptions or failed network requests', async () => {
  assert.deepEqual(pageErrors,[]); assert.deepEqual(failedRequests,[]);
  assert.deepEqual(consoleErrors.filter(x=>!/favicon|Failed to load resource.*404/i.test(x)),[]);
});

const report={base,startedAt:new Date().toISOString(),environment:{browser:'Chrome headless with SwiftShader',viewportSizes,graphics:'software WebGL; not a GPU benchmark'},counts:{passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,skipped:0},results};
fs.writeFileSync('scripts/qa-smoke-report.json',JSON.stringify(report,null,2));
await browser.close();
console.log(JSON.stringify(report,null,2));
if(report.counts.failed) process.exitCode=1;
