export const worldPoint=([lon,lat])=>[20+(lon+180)*2,40+(85-lat)*360/145];
export const secureRandom=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;

const CONTINENTS=new Set(['Europe','Asia','North America','South America','Oceania']);
export const isMainlandCandidate=p=>p.landmass==='continental-mainland'&&CONTINENTS.has(p.continent);
export const isFamousCandidate=p=>isMainlandCandidate(p)&&p.curation==='korean-traveler-famous-city';

// 편집 선정한 유명 도시를 한 목록에 모아 도시마다 같은 확률로 골라요.
export function chooseCandidate(destinations,random=secureRandom,used=new Set()) {
  const cities=destinations.filter(p=>!used.has(p.id)&&isFamousCandidate(p));
  if(!cities.length)return null;
  return cities[Math.min(cities.length-1,Math.floor(random()*cities.length))];
}
