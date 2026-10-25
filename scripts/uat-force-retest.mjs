import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900}}); const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:4173',{waitUntil:'domcontentloaded'}); await page.waitForFunction(()=>window.__GODMODE__?.perf.fps>0);
await page.locator('.tab-button').filter({hasText:/^WORLDS$/}).click(); await page.locator('.scenario-row').filter({hasText:'BINARY DANCE'}).getByRole('button').click();
await page.locator('.tab-button').filter({hasText:/^LAB$/}).click(); await page.locator('.tool-button[data-tool="gravity"]').click();
const candidate=await page.evaluate(()=>{
 const a=window.__GODMODE__,w=a.world;
 for(let y=110;y<790;y+=22) for(let x=100;x<1050;x+=22) {
  const p=a.renderer.screenToWorld(x,y);
  if(w.bodies.every(b=>Math.hypot(p.x-b.x,p.y-b.y)>650)) return {x,y,world:p};
 }
 return null;
});
assert.ok(candidate,'could not find a free screen position');
await page.mouse.click(candidate.x,candidate.y);
const snap=async label=>({label,...await page.evaluate(()=>{const a=window.__GODMODE__,b=a.world.bodies.find(b=>b.id===a.selectedId);return {selected:a.selectedId,selectedBody:b?{id:b.id,kind:b.kind,x:b.x,y:b.y,mass:b.mass,radius:b.radius,influence:b.influence,strength:b.strength}:null,bodies:a.world.bodies.map(b=>({id:b.id,kind:b.kind,x:b.x,y:b.y,radius:b.radius,mass:b.mass})),scenario:a.activeScenario,paused:a.clock.paused,time:a.world.time};})});
const steps=[]; steps.push(await snap('placed'));
for(const [label,key,edge] of [['WELL MASS','MASS','Home'],['RADIUS','RADIUS','End'],['INFLUENCE','INFLUENCE RADIUS','End'],['STRENGTH','FORCE STRENGTH','Home']]){
 const loc=page.locator('.slider').filter({hasText:key}).locator('input[type="range"]');
 const count=await loc.count(); if(!count){steps.push({label,count,missing:true,shot:`${label}`});break;}
 await loc.first().focus(); await loc.first().press(edge); await page.waitForTimeout(150);
 steps.push(await snap(label));
}
await page.screenshot({path:'artifacts/user-acceptance/force-lab-retest.png'});
console.log(JSON.stringify({candidate,steps,errors},null,2));
await browser.close(); await context.close();
