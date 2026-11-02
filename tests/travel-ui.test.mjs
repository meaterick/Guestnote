import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { devices } from 'playwright';
import { launch,prepare } from './helpers.mjs';
let app;
const config={firebase:{apiKey:'demo-key',authDomain:'demo-guestnote.firebaseapp.com',projectId:'demo-guestnote',appId:'demo-app'},emulator:{host:'127.0.0.1',firestorePort:8080,authPort:9099}};
before(async()=>{app=await launch();});after(async()=>{await app?.close();});
async function pageFor(options={}){const ctx=await app.browser.newContext(options);await prepare(ctx,{config});const page=await ctx.newPage();await page.goto(app.base);return page;}
async function open(page){await page.click('#tripLaunch');await page.waitForSelector('#travel[data-state=ready]');assert.equal(await page.locator('#tripLand path').count(),17);}
async function validate(page){
  const valid=await page.evaluate(async()=>{const {createLandSampler}=await import('/assets/js/travel-geo.js');const data=await fetch('/assets/data/korea-land.json').then(r=>r.json());const c=document.querySelector('#tripCoords');return !!createLandSampler(data).regionAt([+c.dataset.lon,+c.dataset.lat]);});
  assert.equal(valid,true);assert.match(await page.getAttribute('#tripExternal','href'),/maps\/search\/\?api=1&query=/);
}
test('탐색 효과 후 육지 한 점을 표시하고, 다시 뽑기·전국 보기가 돼요',async()=>{
  const page=await pageFor({viewport:{width:1280,height:820}});
  try{await open(page);await page.click('#tripDraw');assert.equal(await page.getAttribute('#travel','data-state'),'drawing');assert.equal(await page.isDisabled('#tripDraw'),true);await page.waitForSelector('#travel[data-state=result]');await validate(page);assert.equal(await page.isVisible('#tripOverview'),true);if(process.env.TRIP_SCREENSHOTS)await page.screenshot({path:new URL('../../trip-desktop.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});await page.click('#tripOverview');assert.equal(await page.isHidden('#tripOverview'),true);await page.click('#tripDraw');await page.keyboard.press('Escape');await page.waitForTimeout(3100);assert.equal(await page.isVisible('#travel'),false);await page.click('#tripLaunch');assert.equal(await page.isDisabled('#tripDraw'),false);}finally{await page.context().close();}
});
test('휴대폰에서는 화면에 맞고, 동작 줄이기에서는 곧바로 결과를 보여 줘요',async()=>{
  const page=await pageFor({...devices['iPhone 13'],reducedMotion:'reduce'});
  try{await open(page);await page.click('#tripDraw');await page.waitForSelector('#travel[data-state=result]',{timeout:1500});await validate(page);const bounds=await page.locator('#travel').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);assert.equal(await page.evaluate(()=>document.querySelector('.trip-panel').scrollWidth>document.querySelector('.trip-panel').clientWidth),false);if(process.env.TRIP_SCREENSHOTS)await page.screenshot({path:new URL('../../trip-mobile.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});}finally{await page.context().close();}
});
test('지도 로딩 실패 후 다시 열면 복구돼요',async()=>{
  const page=await pageFor({reducedMotion:'reduce'});let fail=true;
  await page.route('**/korea-land.json',r=>fail?r.fulfill({status:503,body:'unavailable'}):r.continue());
  try{await page.click('#tripLaunch');await page.waitForSelector('#travel[data-state=error]');assert.equal(await page.isDisabled('#tripDraw'),true);await page.keyboard.press('Escape');fail=false;await open(page);await page.click('#tripDraw');await page.waitForSelector('#travel[data-state=result]');}finally{await page.context().close();}
});
