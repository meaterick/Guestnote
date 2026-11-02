import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devices } from 'playwright';
import { launch,prepare } from './helpers.mjs';
const all=JSON.parse(fs.readFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url)));
const destinations=[['Paris','FRA'],['Seoul','KOR'],['Sydney','AUS']].map(([city,country])=>all.destinations.find(p=>p.cityEn===city&&p.countryCode===country)).filter(Boolean);
let app;const config={firebase:{apiKey:'demo-key',authDomain:'demo-guestnote.firebaseapp.com',projectId:'demo-guestnote',appId:'demo-app'},emulator:{host:'127.0.0.1',firestorePort:8080,authPort:9099}};
before(async()=>{app=await launch();});after(async()=>{await app?.close();});
async function pageFor(options={},mode='safe'){
  const ctx=await app.browser.newContext(options);await prepare(ctx,{config});const page=await ctx.newPage();
  await page.route('**/world-destinations.json',r=>r.fulfill({json:{destinations}}));
  const requests=[];
  await page.route('https://gis.0404.go.kr/**',async r=>{
    const url=new URL(r.request().url());requests.push(url);
    if(mode==='error')return r.fulfill({status:503,body:'offline'});
    const p=destinations.find(p=>`${p.lon},${p.lat}`===url.searchParams.get('geometry'));
    const features=url.pathname.includes('/4/')?[{attributes:{alert_cd:mode==='blocked'?'BN':'NM',ntn_alpha_3_cd:p.countryCode,ntn_nm:p.country,adm_nm:p.area}}]:[];
    return r.fulfill({json:{features}});
  });
  await page.goto(app.base);return {page,requests};
}
async function open(page){await page.click('#tripLaunch');await page.waitForSelector('#travel[data-state=ready]');assert.ok(await page.locator('#tripLand path').count()>150);}
test('세계 지도에서 국가·구체적인 도시·실시간 확인 결과를 표시해요',async()=>{
  const {page,requests}=await pageFor({viewport:{width:1280,height:820}});
  try{await open(page);await page.click('#tripDraw');assert.equal(await page.isDisabled('#tripDraw'),true);await page.waitForSelector('#travel[data-state=result]');assert.ok(destinations.map(p=>p.city).includes(await page.textContent('#tripName')));assert.match(await page.textContent('#tripPlaceStatus'),/1단계.*확인/);assert.ok(requests.some(u=>u.pathname.includes('/5/')));assert.ok(requests.some(u=>u.pathname.includes('/17/')));assert.match(await page.getAttribute('#tripExternal','href'),/maps\/search/);assert.equal(await page.isVisible('#tripOverview'),true);if(process.env.TRIP_SCREENSHOTS)await page.screenshot({path:fileURLToPath(new URL('../../world-desktop.png',import.meta.url))});await page.click('#tripOverview');await page.click('#tripDraw');await page.keyboard.press('Escape');await page.waitForTimeout(3100);assert.equal(await page.isVisible('#travel'),false);}finally{await page.context().close();}
});
test('모바일·동작 줄이기에서도 구체적 지명을 표시하고 화면이 넘치지 않아요',async()=>{
  const {page}=await pageFor({...devices['iPhone 13'],reducedMotion:'reduce'});
  try{await open(page);await page.click('#tripDraw');await page.waitForSelector('#travel[data-state=result]');assert.ok((await page.textContent('#tripProvince')).length>0);assert.ok((await page.textContent('#tripCityEn')).length>0);assert.equal(await page.evaluate(()=>document.querySelector('.trip-panel').scrollWidth>document.querySelector('.trip-panel').clientWidth),false);if(process.env.TRIP_SCREENSHOTS)await page.screenshot({path:fileURLToPath(new URL('../../world-mobile.png',import.meta.url))});}finally{await page.context().close();}
});
for(const mode of ['blocked','error'])test(mode==='blocked'?'고위험 지역만 나오면 후보를 확정하지 않아요':'경보 서버에 연결할 수 없으면 임의의 여행지를 보여 주지 않아요',async()=>{
  const {page}=await pageFor({reducedMotion:'reduce'},mode);
  try{await open(page);await page.click('#tripDraw');await page.waitForSelector('#travel[data-state=error]');assert.equal(await page.isHidden('#tripLinks'),true);assert.equal(await page.isDisabled('#tripDraw'),false);const shown=await page.textContent('#tripName');assert.equal(destinations.some(p=>p.city===shown),false);}finally{await page.context().close();}
});
test('세계 지도 로딩 실패 후 다시 열면 복구돼요',async()=>{
  const {page}=await pageFor({reducedMotion:'reduce'});let fail=true;await page.route('**/world-map.json',r=>fail?r.fulfill({status:503,body:'error'}):r.continue());
  try{await page.click('#tripLaunch');await page.waitForSelector('#travel[data-state=error]');await page.keyboard.press('Escape');fail=false;await open(page);await page.click('#tripDraw');await page.waitForSelector('#travel[data-state=result]');}finally{await page.context().close();}
});
