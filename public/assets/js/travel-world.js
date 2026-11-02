import { $,setupDialog,toast } from './ui.js';
import { worldPoint,chooseCandidate,isFamousCandidate } from './world-geo.js';
import { selectVerifiedDestination } from './safe-travel.js';
const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs={}){const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;}
const show=(el,on)=>{el.style.display=on?'':'none';};
export function setupTravel(){
  const dialog=$('#travel'),camera=$('#tripCamera'),land=$('#tripLand'),marker=$('#tripMarker'),trail=$('#tripTrail'),sparks=$('#tripSparks');
  const draw=$('#tripDraw'),name=$('#tripName'),province=$('#tripProvince'),cityEn=$('#tripCityEn'),status=$('#tripStatus'),coords=$('#tripCoords'),check=$('#tripPlaceStatus'),links=$('#tripLinks'),overview=$('#tripOverview');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),paths=new Map(),animations=new Set();
  let destinations=[],loading,ready=false,ticket=0,frame=0,request=null,deadline=0,lastResult=null;
  const fullMap=()=>{camera.style.transform='';overview.hidden=true;};
  function effectsOff(){for(const a of animations)a.cancel();animations.clear();trail.replaceChildren();sparks.replaceChildren();}
  function clearResult(){province.hidden=true;cityEn.hidden=true;check.hidden=true;links.hidden=true;show(marker,false);paths.forEach(p=>p.classList.remove('is-picked'));}
  function endBusy(){draw.disabled=!ready;draw.removeAttribute('aria-busy');$('.trip-announcement',dialog).removeAttribute('aria-busy');clearTimeout(deadline);}
  function stop(){ticket++;cancelAnimationFrame(frame);request?.abort();request=null;effectsOff();endBusy();
    if(lastResult)render(lastResult,false);else{dialog.dataset.state=ready?'ready':'loading';clearResult();name.textContent='이번엔 어느 나라일까?';coords.textContent='나라를 넘어, 새로운 도시로';draw.textContent='세계 여행지 뽑기 ↗';}
  }
  const modal=setupDialog(dialog,{onClose:stop});
  function pin(point){const [x,y]=worldPoint([point.lon,point.lat]);marker.setAttribute('transform',`translate(${x} ${y})`);show(marker,true);paths.forEach((p,code)=>p.classList.toggle('is-picked',code===point.countryCode));}
  function render(point,animate){
    lastResult=point;dialog.dataset.state='result';pin(point);endBusy();
    name.textContent=point.city;province.textContent=point.advisory.country||point.country;province.hidden=false;
    cityEn.textContent=[point.cityEn,point.area].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' · ');cityEn.hidden=false;
    status.textContent='오늘의 세계 여행 후보';
    coords.textContent=`${Math.abs(point.lat).toFixed(5)}° ${point.lat<0?'S':'N'} / ${Math.abs(point.lon).toFixed(5)}° ${point.lon<0?'W':'E'}`;
    coords.dataset.lat=point.lat;coords.dataset.lon=point.lon;coords.dataset.country=point.countryCode;
    check.textContent=`${point.advisory.label} · ${new Date(point.advisory.checkedAt).toLocaleString('ko-KR')} 확인`;check.hidden=false;
    $('#tripExternal').href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;links.hidden=false;draw.textContent='다시 뽑기 ↗';
    if(animate&&!reduced.matches){
      const [x,y]=worldPoint([point.lon,point.lat]),scale=1.8;
      camera.style.transform=`translate(${380-x*scale}px,${220-y*scale}px) scale(${scale})`;overview.hidden=false;
      for(let i=0;i<18;i++){const a=i*Math.PI/9,d=20+Math.random()*30,dot=svg('circle',{cx:x,cy:y,r:2+Math.random()*2,fill:i%2?'#e37643':'#fff6d5'});sparks.append(dot);
        const animation=dot.animate([{opacity:1,transform:'translate(0,0)'},{opacity:0,transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d}px)`}],{duration:800,easing:'ease-out',fill:'forwards'});
        animations.add(animation);animation.finished.then(()=>{animations.delete(animation);dot.remove();}).catch(()=>{});
      }
    }
  }
  async function load(){
    if(ready)return;
    if(!loading)loading=(async()=>{
      const urls=['world-map.json','world-destinations.json'];
      const [map,catalog]=await Promise.all(urls.map(async file=>{const response=await fetch(new URL('../data/'+file,import.meta.url));if(!response.ok)throw new Error('세계 지도를 불러오지 못했어요. 다시 열어 주세요.');return response.json();}));
      const pathOf=rings=>rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${worldPoint(p).map(v=>v.toFixed(2)).join(',')}`).join('')+'Z').join('');
      land.replaceChildren();paths.clear();
      for(const f of map.features){const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
        const path=svg('path',{d:polygons.map(pathOf).join(''),class:'trip-region','fill-rule':'evenodd'});const title=svg('title');title.textContent=f.properties.name;path.append(title);land.append(path);paths.set(f.properties.code,path);}
      const layer=$('#tripLabels');layer.replaceChildren();
      for(const [label,lon,lat] of [['북아메리카',-105,48],['남아메리카',-60,-12],['유럽',15,51],['아프리카',20,5],['아시아',95,43],['오세아니아',140,-26]]){const [x,y]=worldPoint([lon,lat]),text=svg('text',{x,y,'text-anchor':'middle'});text.textContent=label;layer.append(text);}
      destinations=catalog.destinations.filter(isFamousCandidate);if(!destinations.length)throw new Error('조건에 맞는 유명 도시 후보가 없어요.');
      $('#tripScope').textContent=`한국 여행자에게 익숙한 유명 도시 ${destinations.length}곳 · 아프리카·섬 제외`;
      ready=true;
    })().catch(err=>{loading=null;ready=false;throw err;});
    await loading;
  }
  $('#tripLaunch').addEventListener('click',async()=>{
    modal.open();const mine=++ticket;
    if(ready){if(lastResult)render(lastResult,false);else{dialog.dataset.state='ready';status.textContent='경보를 확인한 도시만 여행 후보로 골라요.';endBusy();}return;}
    dialog.dataset.state='loading';draw.disabled=true;status.textContent='세계 지도를 펼치는 중…';
    try{await load();if(mine!==ticket||!modal.isOpen)return;dialog.dataset.state='ready';status.textContent='경보를 확인한 도시만 여행 후보로 골라요.';draw.disabled=false;}
    catch(err){if(mine!==ticket)return;dialog.dataset.state='error';status.textContent=err.message;}
  });
  draw.addEventListener('click',()=>{
    if(!ready||draw.disabled)return;
    const mine=++ticket;request?.abort();request=new AbortController();const controller=request;
    effectsOff();fullMap();clearResult();dialog.dataset.state='drawing';
    status.textContent='도시·지역의 최신 여행경보 확인 중…';name.textContent='여행 가능한 후보를 찾는 중';coords.textContent='외교부 0~1단계만 · 고위험·확인 불가 지역 제외';
    draw.disabled=true;draw.textContent='여행경보 확인 중…';draw.setAttribute('aria-busy','true');$('.trip-announcement',dialog).setAttribute('aria-busy','true');
    deadline=setTimeout(()=>controller.abort(),30000);
    let destination=null,failure=null,done=false;
    const task=selectVerifiedDestination(destinations,{signal:controller.signal,onAttempt:n=>{if(mine===ticket)status.textContent=`도시·지역의 여행경보 확인 중 · 후보 ${n}`;}})
      .then(p=>{destination=p;}).catch(err=>{failure=err;}).finally(()=>{done=true;});
    function finish(){if(mine!==ticket||!modal.isOpen)return;trail.replaceChildren();if(destination)render(destination,true);else{endBusy();clearResult();dialog.dataset.state='error';name.textContent='경보 확인 후 뽑을 수 있어요';status.textContent=failure?.name==='AbortError'?'조회 시간이 길어져 멈췄어요. 다시 시도해 주세요.':failure?.message||'여행경보를 확인하지 못했어요.';coords.textContent='확인되지 않은 지역은 결과로 표시하지 않아요.';draw.textContent='다시 확인하기 ↗';}}
    if(reduced.matches){task.then(finish);return;}
    const start=performance.now();let next=0;
    function tick(now){if(mine!==ticket||!modal.isOpen)return;const elapsed=now-start;
      if(elapsed>=next){const p=chooseCandidate(destinations,Math.random);pin(p);const [x,y]=worldPoint([p.lon,p.lat]);trail.append(svg('circle',{cx:x,cy:y,r:2}));while(trail.children.length>7)trail.firstChild.remove();[...trail.children].forEach((d,i)=>d.style.opacity=(i+1)/10);next=elapsed+50+Math.min(1,elapsed/2800)**2*180;}
      if(done&&elapsed>=2800)finish();else frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
  });
  overview.addEventListener('click',fullMap);
  $('#tripCopy').addEventListener('click',async()=>{if(!lastResult)return;try{await navigator.clipboard.writeText(`${lastResult.lat.toFixed(6)}, ${lastResult.lon.toFixed(6)}`);toast('여행지 좌표를 복사했어요.');}catch{toast('좌표를 길게 눌러 복사해 주세요.');}});
  clearResult();
}
