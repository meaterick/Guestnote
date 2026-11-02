import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessAdvisory,checkAdvisory,selectVerifiedDestination } from '../public/assets/js/safe-travel.js';
import { chooseCandidate,worldPoint,isMainlandCandidate } from '../public/assets/js/world-geo.js';
const point={id:'tokyo',countryCode:'JPN',lon:139.6917,lat:35.6895};
const eligible={id:'madrid',countryCode:'ESP',lon:-3.7,lat:40.41,continent:'Europe',landmass:'continental-mainland',curation:'korean-traveler-famous-city'};
const empty={features:[]};
const layer=(code,country='JPN')=>({features:[{attributes:{alert_cd:code,ntn_alpha_3_cd:country,ntn_nm:'일본',adm_nm:'도쿄'}}]});
test('명시적으로 경보 미발령 또는 1단계인 곳만 허용해요',()=>{
  for(const code of ['NA','NM'])assert.equal(assessAdvisory(point,layer(code),empty,empty).allowed,true);
  for(const code of ['CT','RC','BN','AL'])assert.equal(assessAdvisory(point,layer(code),empty,empty).allowed,false);
});
test('국가가 낮은 단계여도 해당 지역이나 특별구역이 높으면 제외해요',()=>{
  assert.equal(assessAdvisory(point,layer('NA'),layer('BN'),empty).allowed,false);
  assert.equal(assessAdvisory(point,layer('NM'),empty,layer('AL')).allowed,false);
});
test('알 수 없는 코드·빈 응답·다른 나라·잘린 응답을 안전하다고 간주하지 않아요',()=>{
  for(const result of [assessAdvisory(point,layer(null),empty,empty),assessAdvisory(point,empty,empty,empty),assessAdvisory(point,layer('NA','UKR'),empty,empty),assessAdvisory(point,layer('NA'),layer('NEW'),empty),assessAdvisory(point,{...layer('NA'),exceededTransferLimit:true},empty,empty),assessAdvisory(point,{error:{}},empty,empty)])assert.equal(result.allowed,false);
});
test('확인 시각과 공식 국가명을 결과에 함께 남겨요',()=>{
  const result=assessAdvisory(point,layer('NM'),empty,empty,'2026-11-02T12:00:00Z');assert.equal(result.level,1);assert.equal(result.country,'일본');assert.equal(result.checkedAt,'2026-11-02T12:00:00Z');
});
test('실제 좌표로 세 레이어를 모두 조회하고 특별구역은 주변까지 확인해요',async()=>{
  const calls=[];
  const result=await checkAdvisory(point,{fetcher:async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>url.pathname.includes('/4/')?layer('NA'):empty};}});
  assert.equal(result.allowed,true);assert.equal(calls.length,3);
  for(const [url,options] of calls){assert.equal(url.searchParams.get('geometry'),'139.6917,35.6895');assert.equal(url.searchParams.get('inSR'),'4326');assert.equal(options.credentials,'omit');if(url.pathname.includes('/17/'))assert.equal(url.searchParams.get('distance'),'10000');}
});
test('통신 오류·서버 오류 때는 미확인 결과를 반환하지 않아요',async()=>{
  await assert.rejects(checkAdvisory(point,{fetcher:async()=>({ok:false})}));
  await assert.rejects(checkAdvisory(point,{fetcher:async()=>({ok:true,json:async()=>({error:{code:500}})})}));
});
test('조회 시간이 넘으면 요청을 취소해요',async()=>{
  await assert.rejects(checkAdvisory(point,{timeout:5,fetcher:async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))}),{name:'AbortError'});
});
test('고위험 후보를 건너뛰고 검증된 후보만 확정해요',async()=>{
  let count=0;const candidates=[eligible,{...eligible,id:'b'}];
  const result=await selectVerifiedDestination(candidates,{random:()=>0,verify:async()=>++count===1?{allowed:false,level:4}:{allowed:true,level:1}});
  assert.equal(result.id,'b');assert.equal(result.advisory.level,1);
});
test('모든 후보가 제외되거나 검증 결과가 불완전하면 추첨을 멈춰요',async()=>{
  for(const result of [{allowed:false},{allowed:true},{allowed:true,level:2}])await assert.rejects(selectVerifiedDestination([eligible],{verify:async()=>result}));
});
test('확인 중 취소되면 늦은 성공 응답도 결과로 내보내지 않아요',async()=>{
  const controller=new AbortController();await assert.rejects(selectVerifiedDestination([eligible],{signal:controller.signal,verify:async()=>{controller.abort();return {allowed:true,level:0};}}),{name:'AbortError'});
});
test('세계 후보에는 구체적인 도시명과 좌표가 있고 남반구·서반구도 포함돼요',()=>{
  const {destinations}=JSON.parse(fs.readFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url)));
  assert.ok(destinations.length>200);assert.ok(new Set(destinations.map(p=>p.countryCode)).size>40);assert.equal(new Set(destinations.map(p=>p.id)).size,destinations.length);
  for(const p of destinations){assert.ok(p.city&&p.country);assert.ok(p.lon>=-180&&p.lon<=180&&p.lat>=-60&&p.lat<=85);}
  assert.ok(destinations.some(p=>p.lat<0));assert.ok(destinations.some(p=>p.lon<0));
});
test('선정한 유명 도시가 각각 같은 확률로 뽑혀요',()=>{
  let seed=1234;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const pool=Array.from({length:4},(_,i)=>({...eligible,id:String(i)})),counts=[0,0,0,0];
  for(let i=0;i<10000;i++)counts[+chooseCandidate(pool,random).id]++;counts.forEach(n=>assert.ok(Math.abs(n/10000-.25)<.03));
  assert.deepEqual(worldPoint([-180,85]),[20,40]);
});
test('아프리카·섬과 지리 조건을 확인하지 못한 후보는 추첨하지 않아요',async()=>{
  const invalid=[{...eligible,id:'africa',continent:'Africa'},{...eligible,id:'island',landmass:'island'},{...eligible,id:'unknown',landmass:undefined}];
  invalid.forEach(p=>assert.equal(isMainlandCandidate(p),false));assert.equal(chooseCandidate(invalid),null);
  let calls=0;await assert.rejects(selectVerifiedDestination(invalid,{verify:async()=>{calls++;return {allowed:true,level:0};}}));assert.equal(calls,0);
  assert.equal(chooseCandidate([...invalid,eligible]).id,eligible.id);
});
test('실제 후보에서 아프리카 국가·섬나라·본토 국가의 섬 도시가 빠져 있어요',()=>{
  const {destinations,selection}=JSON.parse(fs.readFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url)));
  const map=JSON.parse(fs.readFileSync(new URL('../public/assets/data/world-map.json',import.meta.url)));
  const africanCountries=new Set(map.features.filter(f=>f.properties.continent==='Africa').map(f=>f.properties.code));
  const islandCountries=new Set(['JPN','GBR','TWN','NZL','IDN','PHL','IRL','ISL','MLT','CYP','SGP','LKA','CUB','MDG']);
  for(const p of destinations){assert.equal(isMainlandCandidate(p),true);assert.equal(africanCountries.has(p.countryCode),false);assert.equal(islandCountries.has(p.countryCode),false);}
  for(const name of ['Hobart','Honolulu','Palermo','Jeju','Ceuta','Melilla','Copenhagen'])assert.equal(destinations.some(p=>p.cityEn===name),false,name);
  assert.ok(destinations.some(p=>p.countryCode==='AUS'&&p.cityEn==='Sydney'));
  assert.equal(selection.curated,true);
});
test('익숙한 관광도시가 포함되고 무작위 중소도시 확장은 하지 않아요',()=>{
  const {destinations}=JSON.parse(fs.readFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url)));
  for(const city of ['Paris','Rome','Barcelona','Bangkok','Sydney','Seoul'])assert.ok(destinations.some(p=>p.cityEn===city),city);
  assert.equal(destinations.some(p=>p.cityEn==='Faribault'),false);destinations.forEach(p=>assert.equal(p.curation,'korean-traveler-famous-city'));
});
test('선정하지 않은 도시를 섞어도 추첨하지 않아요',()=>{
  const pool=[{...eligible,id:'not-curated',curation:undefined},eligible];
  assert.equal(chooseCandidate(pool,()=>0).id,eligible.id);
  assert.equal(chooseCandidate(pool,()=>0,new Set([eligible.id])),null);
});
