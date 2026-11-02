export const worldPoint=([lon,lat])=>[20+(lon+180)*2,40+(85-lat)*360/145];
export const secureRandom=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;

// 한 국가에 후보 도시가 많다는 이유만으로 그 국가가 더 자주 뽑히지 않게 해요.
export function chooseCandidate(destinations,random=secureRandom,used=new Set()) {
  const countries=new Map();
  for(const p of destinations){if(used.has(p.id))continue;if(!countries.has(p.countryCode))countries.set(p.countryCode,[]);countries.get(p.countryCode).push(p);}
  const groups=[...countries.values()];
  if(!groups.length)return null;
  const cities=groups[Math.min(groups.length-1,Math.floor(random()*groups.length))];
  return cities[Math.min(cities.length-1,Math.floor(random()*cities.length))];
}
