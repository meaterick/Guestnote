import { chooseCandidate,secureRandom } from './world-geo.js';

// 외교부 공개 여행경보 지도와 같은 필드/코드를 사용해요. 알 수 없는 값은 허용하지 않아요.
export const ADVISORY_SERVICE='https://gis.0404.go.kr/server/rest/services/safeMap/'+encodeURIComponent('경보행정구역')+'/FeatureServer/';
const levels={NA:0,NM:1,CT:2,RC:3,BN:4,AL:2.5};
export function assessAdvisory(point,base,overlays,special,checkedAt=new Date().toISOString()) {
  const lists=[base,overlays,special];
  if(lists.some(j=>j.error||j.exceededTransferLimit||!Array.isArray(j.features)))return {allowed:false,reason:'unknown'};
  const attributes=j=>j.features.map(f=>f.attributes);
  const coverage=[...attributes(base),...attributes(special)].filter(a=>a.ntn_alpha_3_cd===point.countryCode);
  if(!coverage.length)return {allowed:false,reason:'uncovered'};
  const all=[...attributes(base),...attributes(overlays),...attributes(special)];
  if(all.some(a=>!Object.hasOwn(levels,a.alert_cd)))return {allowed:false,reason:'unknown'};
  const level=Math.max(...all.map(a=>levels[a.alert_cd]));
  return {allowed:level<=1,level,country:coverage[0].ntn_nm,region:coverage.find(a=>a.adm_nm)?.adm_nm||'',checkedAt,
    label:level===0?'여행경보 미발령':level===1?'1단계 · 여행유의':'추첨 기준 제외'};
}

export async function checkAdvisory(point,{fetcher=fetch,signal,timeout=8000}={}) {
  const controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const timer=setTimeout(abort,timeout);
  try {
    const query=async layer=>{
      const url=new URL(ADVISORY_SERVICE+layer+'/query');
      const fields=layer===5?'alert_cd,ntn_nm,ntn_alpha_3_cd,area_nm':'alert_cd,ntn_nm,ntn_alpha_3_cd,adm_nm';
      url.search=new URLSearchParams({f:'json',geometry:`${point.lon},${point.lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:fields,returnGeometry:'false',
        // 작은 섬 등 점으로 관리되는 특별구역도 보수적으로 확인해요.
        ...(layer===17?{distance:'10000',units:'esriSRUnit_Meter'}:{})});
      const response=await fetcher(url,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('여행경보를 확인하지 못했어요. 다시 시도해 주세요.');
      const data=await response.json();
      if(data.error||data.exceededTransferLimit||!Array.isArray(data.features))throw new Error('여행경보 응답을 확인하지 못했어요.');
      return data;
    };
    const [base,overlays,special]=await Promise.all([query(4),query(5),query(17)]);
    return assessAdvisory(point,base,overlays,special);
  }catch(err){
    if(err?.name==='AbortError')throw err;
    throw new Error('외교부 여행경보를 확인하지 못해 추첨을 멈췄어요. 연결을 확인하고 다시 시도해 주세요.');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

export async function selectVerifiedDestination(destinations,{verify=checkAdvisory,random=secureRandom,signal,maxAttempts=12,onAttempt=()=>{}}={}) {
  const used=new Set();
  for(let i=0;i<maxAttempts;i++){
    if(signal?.aborted)throw new DOMException('취소했어요.','AbortError');
    const point=chooseCandidate(destinations,random,used);if(!point)break;used.add(point.id);
    onAttempt(i+1);
    const advisory=await verify(point,{signal});
    if(signal?.aborted)throw new DOMException('취소했어요.','AbortError');
    if(advisory.allowed&&Number.isFinite(advisory.level)&&advisory.level<=1)return {...point,advisory};
  }
  throw new Error('이번에는 조건에 맞는 여행지를 확인하지 못했어요. 다시 뽑아 주세요.');
}
