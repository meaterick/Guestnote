import { $, setupDialog, toast } from './ui.js';
import { createLandSampler, project, secureRandom } from './travel-geo.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
};

export function setupTravel() {
  const dialog = $('#travel');
  const camera = $('#tripCamera');
  const land = $('#tripLand');
  const marker = $('#tripMarker');
  const trail = $('#tripTrail');
  const sparks = $('#tripSparks');
  const draw = $('#tripDraw');
  const name = $('#tripName');
  const status = $('#tripStatus');
  const coords = $('#tripCoords');
  const links = $('#tripLinks');
  const overview = $('#tripOverview');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let sampler, loading, toScreen;
  let frame = 0, ticket = 0, lastResult = null;
  let paths = new Map();
  const animations = new Set();
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  function clearEffects() {
    for (const a of animations) a.cancel();
    animations.clear(); sparks.replaceChildren(); trail.replaceChildren();
  }
  function stop() {
    $('.trip-announcement',dialog).removeAttribute('aria-busy');
    ticket++; cancelAnimationFrame(frame); clearEffects();
    dialog.dataset.state = sampler ? 'ready' : 'loading';
    draw.disabled = !sampler;
    draw.textContent = lastResult ? '다시 뽑기 ↗' : '여행지 뽑기 ↗';
    draw.removeAttribute('aria-busy');
    if (lastResult) result(lastResult, false);
    else { show(marker,false); paths.forEach(p=>p.classList.remove('is-picked')); name.textContent='어디로 가게 될까?'; status.textContent='바다를 빼고, 땅 위의 한 점을 골라요.'; coords.textContent='북쪽에서 남쪽까지, 섬에서 내륙까지'; links.hidden=true; }
  }
  const modal = setupDialog(dialog, { onClose: stop });
  const fullMap = () => { camera.style.transform = ''; overview.hidden = true; };

  function pin(point) {
    const [x,y] = toScreen(point.xy);
    marker.setAttribute('transform', `translate(${x} ${y})`);
    show(marker,true);
    paths.forEach((p,code)=>p.classList.toggle('is-picked',code===point.region.code));
  }
  function result(point, animate) {
    $('.trip-announcement',dialog).removeAttribute('aria-busy');
    lastResult=point;
    dialog.dataset.state='result';
    pin(point);
    name.textContent=point.region.name;
    coords.textContent=`${point.lat.toFixed(6)}° N  /  ${point.lon.toFixed(6)}° E`;
    coords.dataset.lat=point.lat; coords.dataset.lon=point.lon;
    status.textContent='오늘의 목적지, 이곳!';
    $('#tripExternal').href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
    links.hidden=false;
    draw.disabled=false; draw.textContent='다시 뽑기 ↗'; draw.removeAttribute('aria-busy');
    if (animate && !reduced.matches) {
      const [x,y]=toScreen(point.xy), scale=1.38;
      camera.style.transform=`translate(${280-x*scale}px, ${280-y*scale}px) scale(${scale})`;
      overview.hidden=false;
      for(let i=0;i<18;i++){
        const angle=i*Math.PI*2/18, distance=30+Math.random()*35;
        const dot=svg('circle',{cx:x,cy:y,r:2+Math.random()*2,fill:i%2?'#e37643':'#fff6d5'});
        sparks.append(dot);
        const a=dot.animate([{opacity:1,transform:'translate(0,0)'},{opacity:0,transform:`translate(${Math.cos(angle)*distance}px,${Math.sin(angle)*distance}px)`}],{duration:800,easing:'cubic-bezier(.1,.7,.3,1)',fill:'forwards'});
        animations.add(a); a.finished.then(()=>{animations.delete(a);dot.remove();}).catch(()=>{});
      }
    }
  }

  async function load() {
    if (sampler) return;
    if (!loading) loading = (async () => {
      const response=await fetch(new URL('../data/korea-land.json',import.meta.url));
      if(!response.ok)throw new Error('지도를 불러오지 못했어요. 다시 열어 주세요.');
      sampler=createLandSampler(await response.json());
      const [a,b,c,d]=sampler.bounds, scale=Math.min(486/(c-a),486/(d-b));
      toScreen=([x,y])=>[280+(x-(a+c)/2)*scale,280+(y-(b+d)/2)*scale];
      const pathOf=rings=>rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${toScreen(p).map(n=>n.toFixed(2)).join(',')}`).join('')+'Z').join('');
      for(const region of sampler.regions){
        const path=svg('path',{d:region.polygons.map(pathOf).join(''),class:'trip-region','fill-rule':'evenodd'});
        const title=svg('title');title.textContent=region.name;path.append(title);
        land.append(path);paths.set(region.code,path);
      }
      const labels=[['서울',126.98,37.7],['강원',128.35,37.75],['충청',127.25,36.65],['전라',126.96,35.35],['경상',128.55,36.1],['부산',129.15,34.95],['제주',126.55,33.2],['울릉도',130.89,37.3],['독도',131.75,37.05]];
      const labelLayer=$('#tripLabels');
      for(const [text,lon,lat] of labels){const [x,y]=toScreen(project([lon,lat]));const t=svg('text',{x,y,'text-anchor':'middle'});t.textContent=text;labelLayer.append(t);}
    })().catch(err=>{sampler=null;loading=null;throw err;});
    await loading;
  }

  $('#tripLaunch').addEventListener('click',async()=>{
    modal.open();
    const mine=++ticket;
    if(sampler){ draw.disabled=false; if(lastResult)result(lastResult,false); else { dialog.dataset.state='ready'; status.textContent='바다를 빼고, 땅 위의 한 점을 골라요.'; } return; }
    dialog.dataset.state='loading'; status.textContent='전국 지도를 펼치는 중…'; draw.disabled=true;
    try{
      await load();
      if(mine!==ticket || !modal.isOpen)return;
      dialog.dataset.state='ready';status.textContent='바다를 빼고, 땅 위의 한 점을 골라요.';draw.disabled=false;
    }catch(err){if(mine!==ticket)return;dialog.dataset.state='error';status.textContent=err.message;draw.disabled=true;}
  });
  draw.addEventListener('click',()=>{
    if(!sampler || draw.disabled)return;
    const mine=++ticket;
    clearEffects();fullMap();
    const destination=sampler.sample(secureRandom);
    links.hidden=true;coords.textContent='북쪽에서 남쪽까지, 섬에서 내륙까지';
    draw.disabled=true;draw.setAttribute('aria-busy','true');draw.textContent='목적지 찾는 중…';
    $('.trip-announcement',dialog).setAttribute('aria-busy','true');
    if(reduced.matches){result(destination,false);return;}
    dialog.dataset.state='drawing';status.textContent='어디든 좋아요. 잠시만 기다려요.';
    const start=performance.now(), duration=2800;
    let next=0;
    function tick(now){
      if(mine!==ticket || !modal.isOpen)return;
      const elapsed=now-start, progress=Math.min(1,elapsed/duration);
      if(elapsed>=next){
        const point=sampler.sample();pin(point);name.textContent=point.region.name;
        const [x,y]=toScreen(point.xy);trail.append(svg('circle',{cx:x,cy:y,r:3}));
        while(trail.childNodes.length>7)trail.firstChild.remove();
        [...trail.children].forEach((dot,i)=>dot.style.opacity=(i+1)/10);
        next=elapsed+45+progress*progress*220;
      }
      if(progress<1)frame=requestAnimationFrame(tick);
      else{trail.replaceChildren();result(destination,true);}
    }
    frame=requestAnimationFrame(tick);
  });
  overview.addEventListener('click',fullMap);
  $('#tripCopy').addEventListener('click',async()=>{
    if(!lastResult)return;
    try{await navigator.clipboard.writeText(`${lastResult.lat.toFixed(6)}, ${lastResult.lon.toFixed(6)}`);toast('여행지 좌표를 복사했어요.');}
    catch{toast('좌표를 길게 눌러 복사해 주세요.');}
  });
  show(marker,false);
}
