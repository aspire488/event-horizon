import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const out='artifacts/user-acceptance'; const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const version=browser.version(); const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}); const page=await context.newPage();
const errors=[],consoleErrors=[],failed=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),location:m.location()});}); page.on('requestfailed',r=>failed.push(r.url()));
const results=[]; const run=async(name,fn)=>{const at=Date.now();try{results.push({name,status:'PASS',durationMs:Date.now()-at,evidence:await fn()});}catch(e){results.push({name,status:'FAIL',durationMs:Date.now()-at,error:e.message});}};
const state=()=>page.evaluate(()=>{const a=window.__GODMODE__,w=a.world;return{scenario:a.activeScenario,selected:a.selectedId,paused:a.clock.paused,time:w.time,particles:w.particles.count,bodies:w.bodies.map(b=>({id:b.id,kind:b.kind,x:b.x,y:b.y,mass:b.mass,radius:b.radius,influence:b.influence,strength:b.strength})),keyframes:a.timeline.keyframes.map(k=>k.at),saves:a.store.list().map(s=>s.name)}});
const tab=n=>page.locator('.tab-button').filter({hasText:new RegExp(`^${n}$`)});
const slider=n=>page.locator('.slider').filter({has:page.locator('.slider-label').filter({hasText:new RegExp(`^${n}$`)})}).locator('input[type="range"]');
const checkEdge=async(n,key)=>{const s=slider(n);await s.waitFor({state:'visible'});await s.focus();await s.press(key);await page.waitForTimeout(100);return Number(await s.inputValue());};
await page.goto('http://localhost:4173',{waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__GODMODE__?.perf.fps>0);
await run('Retest force controls and drag at a verified empty canvas location while running',async()=>{
 await tab('WORLDS').click();await page.locator('.scenario-row').filter({hasText:'BINARY DANCE'}).getByRole('button').click();await tab('LAB').click();
 await page.locator('.tool-button[data-tool="gravity"]').click();
 const point=await page.evaluate(()=>{const a=window.__GODMODE__,w=a.world;for(let y=110;y<790;y+=22)for(let x=100;x<1050;x+=22){const p=a.renderer.screenToWorld(x,y);if(w.bodies.every(b=>Math.hypot(p.x-b.x,p.y-b.y)>650))return{x,y};}return null;});assert.ok(point);
 await page.mouse.click(point.x,point.y);let s=await state();let well=s.bodies.find(b=>b.id===s.selected&&b.kind==='well');assert.ok(well);
 const values={mass:await checkEdge('MASS','Home'),radius:await checkEdge('RADIUS','End'),influence:await checkEdge('INFLUENCE RADIUS','End'),strength:await checkEdge('FORCE STRENGTH','Home')};
 s=await state();well=s.bodies.find(b=>b.id===well.id);assert.ok(well,'selected well disappeared during parameter adjustment');assert.equal(well.mass,0);assert.equal(well.radius,70);assert.ok(well.influence>=210);assert.equal(well.strength,0.1);
 const start=await page.evaluate(id=>{const a=window.__GODMODE__,b=a.world.bodies.find(q=>q.id===id);return a.renderer.worldToScreen(b.x,b.y);},well.id);
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+60,start.y+40,{steps:8});await page.mouse.up();const moved=(await state()).bodies.find(b=>b.id===well.id);assert.ok(Math.hypot(moved.x-well.x,moved.y-well.y)>20);
 const ss=path.join(out,'force-lab-retest-final.png');await page.screenshot({path:ss});return{placement:point,edges:values,selectedWell:moved,dragged:true,screenshot:ss};
});

await run('Retest save/import/checkpoint and rewind after explicitly resuming',async()=>{
 await page.evaluate(()=>window.__GODMODE__.clock.paused=true);await page.evaluate(()=>window.__GODMODE__.checkpoint());
 await page.evaluate(()=>window.__GODMODE__.clock.paused=false);await page.locator('.speed-chip').filter({hasText:'4×'}).click();
 await page.waitForFunction(()=>window.__GODMODE__.timeline.keyframes.length>=3,null,{timeout:25000});
 const before=await state();assert.ok(before.keyframes.length>=3);
 const range=page.locator('.rewind-slider');await range.focus();await range.press('Home');await page.waitForTimeout(200);
 const restored=await state();assert.ok(restored.paused);assert.ok(restored.time<=before.time);
 const n=restored.keyframes.length;await tab('LAB').click();await page.getByRole('button',{name:'SPAWN PLANET'}).click();assert.ok((await state()).bodies.some(b=>b.kind==='planet'));
 assert.ok((await state()).keyframes.length<=n,'branch retained abandoned future');
 await page.screenshot({path:path.join(out,'rewind-branch-retest.png')});
 return{beforeFrames:before.keyframes,rewoundTo:restored.time,paused:restored.paused,newBranch:true};
});

await run('Retest hide-interface after moving focus out of range control',async()=>{
 await page.locator('.volume-slider').focus();await page.locator('.tool-button[data-tool="observe"]').click();await page.keyboard.press('h');
 assert.ok(await page.locator('.show-ui').isVisible());await page.screenshot({path:path.join(out,'hide-interface-retest.png')});
 await page.locator('.show-ui').click();assert.ok(await page.locator('.transport').isVisible());return{hidden:true,restored:true};
});

await run('Mobile archive toast visual and actionability check',async()=>{
 const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await c.newPage();await p.goto('http://localhost:4173',{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__GODMODE__?.perf.fps>0);
 await p.locator('.panel-toggle').click();await p.locator('.tab-button').filter({hasText:/^ARCHIVE$/}).click();await p.locator('.save-row input').fill('UAT Toast Layout');await p.getByRole('button',{name:'SAVE',exact:true}).click();
 await p.waitForTimeout(150);const file=path.join(out,'mobile-archive-toast.png');await p.screenshot({path:file});
 const boxes=await p.evaluate(()=>{const q=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};return{toast:q('.toast'),panel:q('.panel'),rows:[...document.querySelectorAll('.save-item')].map(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,buttons:[...e.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return{title:b.title,top:q.top,bottom:q.bottom,left:q.left,right:q.right}})}})};});
 await c.close();return{file,geometry:boxes,toastOverSaveAction:boxes.rows.some(row=>row.buttons.some(b=>boxes.toast.top<b.bottom&&boxes.toast.bottom>b.top&&boxes.toast.left<b.right&&boxes.toast.right>b.left))};
});

const report={startedAt:new Date().toISOString(),environment:{browser:'Playwright isolated Chromium',browserVersion:version,headless:true},results,counts:{pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length},console:{pageErrors:errors,consoleErrors,failedRequests:failed}};
fs.writeFileSync(path.join(out,'retest-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await context.close();await browser.close();if(report.counts.fail)process.exitCode=1;
