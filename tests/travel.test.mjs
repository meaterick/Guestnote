import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLandSampler, project, unproject, inPolygon } from '../public/assets/js/travel-geo.js';
const data=JSON.parse(fs.readFileSync(new URL('../public/assets/data/korea-land.json',import.meta.url)));
const land=createLandSampler(data);
function seeded(){let state=23456;return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);}
test('실제 전국 지도는 17개 시도와 제주·울릉도·독도를 포함하고 바다와 북한을 제외해요',()=>{
  assert.equal(land.regions.length,17);
  for(const p of [[126.978,37.566],[129.075,35.179],[126.53,33.50],[130.90,37.50]])assert.ok(land.regionAt(p),p.toString());
  for(const p of [[126,35],[129.7,36],[125.75,39.03],[127,32.8]])assert.equal(land.regionAt(p),null,p.toString());
  assert.ok(land.polygons.some(p=>unproject([p.bounds[2],p.bounds[1]])[0]>131.86));
});
test('5천 번 뽑아도 실제 육지 안이고 섬도 뽑혀요',()=>{
  const random=seeded(),seen=new Set();
  for(let i=0;i<5000;i++){const p=land.sample(random);assert.ok(land.regionAt([p.lon,p.lat]));seen.add(p.region.code);}
  assert.equal(seen.size,17);
});
test('등적 투영을 왕복해도 좌표는 같아요',()=>{
  for(const p of [[126,33],[128,37],[131.87,37.24]])unproject(project(p)).forEach((v,i)=>assert.ok(Math.abs(v-p[i])<1e-10));
});
test('폴리곤 안의 구멍은 땅으로 취급하지 않아요',()=>{
  const square=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]];
  assert.equal(inPolygon([2,2],[square,hole]),false);assert.equal(inPolygon([.5,.5],[square,hole]),true);
});
test('지역의 개수가 아닌 육지 면적에 비례해 뽑아요',()=>{
  const feature=(code,x,w)=>({properties:{code},geometry:{type:'Polygon',coordinates:[[[x,34],[x+w,34],[x+w,35],[x,35],[x,34]]]}});
  const s=createLandSampler({features:[feature('small',125,1),feature('big',127,2)]}),random=seeded();let big=0;
  for(let i=0;i<15000;i++)if(s.sample(random).region.code==='big')big++;
  assert.ok(Math.abs(big/15000-2/3)<.02);
});
