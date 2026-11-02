// 실행: node scripts/build-mainland-destinations.mjs <cities.geojson> <land.geojson> <regions.geojson> <countries.geojson>
// 원본: Natural Earth ne_10m_populated_places, ne_10m_land,
// ne_10m_geography_regions_polys, ne_110m_admin_0_countries (public domain).
import fs from 'node:fs';
const [cityFile,landFile,regionFile,countryFile]=process.argv.slice(2);
if(!countryFile)throw new Error('Natural Earth 원본 파일 4개를 지정해 주세요.');
const read=file=>JSON.parse(fs.readFileSync(file));
const [cities,land,regions,countries]=[cityFile,landFile,regionFile,countryFile].map(read);
function inRing([x,y],ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [a,b]=ring[i],[c,d]=ring[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;}return inside;}
const contains=(point,rings)=>inRing(point,rings[0])&&!rings.slice(1).some(r=>inRing(point,r));
const polys=f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
function prepare(rings){const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,y] of rings[0]){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}return {rings,bounds};}
const hit=([x,y],p)=>x>=p.bounds[0]&&x<=p.bounds[2]&&y>=p.bounds[1]&&y<=p.bounds[3]&&contains([x,y],p.rings);
// 유라시아, 아메리카, 호주 대륙의 연결된 육지만 남겨요. 국경으로 나뉜 나라 폴리곤을 섬으로 취급하지 않아요.
const seeds=[[2.35,48.85],[-105,40],[-47.9,-15.8],[133.9,-23.7]];
const mainlands=land.features.flatMap(polys).filter(p=>seeds.some(seed=>contains(seed,p))).map(prepare);
if(mainlands.length<3)throw new Error('대륙 본토 경계를 확인하지 못했어요.');
const continents=regions.features.filter(f=>f.properties.FEATURECLA==='Continent').map(f=>({name:f.properties.NAME,polygons:polys(f).map(prepare)}));
const countryContinent=new Map(countries.features.map(f=>[f.properties.ADM0_A3,f.properties.CONTINENT]));
const continentNames={'EUROPE':'Europe','ASIA':'Asia','NORTH AMERICA':'North America','SOUTH AMERICA':'South America','AUSTRALIA':'Oceania','AFRICA':'Africa','ANTARCTICA':'Antarctica'};
const display=new Intl.DisplayNames(['ko'],{type:'region'});
const blocked=new Set(['AFG','SOM','IRQ','YEM','LBY','UKR','SDN','HTI','MLI','IRN','PRK','SYR','RUS','BLR','SSD','PSE','ISR','LBN','ATA']);
const smallTravelCities=new Set(['Interlaken','Rothenburg ob der Tauber','Cesky Krumlov','Hallstatt','Siena','Lucca','Ronda','Bled','Banff','Jasper','Moab','Sedona']);
const destinations=[];
const counts={africa:0,islandOrUnconfirmedLand:0,tooSmallOrExcluded:0};
for(const f of cities.features){
  const p=f.properties,point=f.geometry.coordinates;
  const geographic=continents.find(c=>c.polygons.some(poly=>hit(point,poly)));
  const continent=continentNames[geographic?.name]||countryContinent.get(p.ADM0_A3);
  // 북아프리카의 스페인 자치도시도 국가명만 보고 유럽으로 포함하지 않아요.
  if(continent==='Africa'||countryContinent.get(p.ADM0_A3)==='Africa'||['Ceuta','Melilla'].includes(p.NAME)||['Ceuta','Melilla'].includes(p.ADM1NAME)){counts.africa++;continue;}
  if(!mainlands.some(poly=>hit(point,poly))){counts.islandOrUnconfirmedLand++;continue;}
  if(blocked.has(p.ADM0_A3)||!p.NAME||!p.ISO_A2||p.ISO_A2==='-99'||/\b(?:Station|Base)\b/.test(p.NAME)||!(p.POP_MAX>=20000||p.ADM0CAP===1||smallTravelCities.has(p.NAME))||!['Europe','Asia','North America','South America','Oceania'].includes(continent)){counts.tooSmallOrExcluded++;continue;}
  let countryName;try{countryName=display.of(p.ISO_A2);}catch{countryName=p.ADM0NAME;}
  destinations.push({id:String(p.NE_ID),countryCode:p.ADM0_A3,country:countryName,city:p.NAME_KO||p.NAME_EN||p.NAME,cityEn:p.NAME_EN||p.NAME,area:p.ADM1NAME||'',lon:point[0],lat:point[1],continent,landmass:'continental-mainland',sourceId:p.GEONAMESID||null});
}
const result={source:'Natural Earth populated places + 10m land + geography regions (public domain)',selection:{minimumPopulation:20000,mainlandOnly:true,excludedContinents:['Africa'],geography:'Natural Earth 육지 경계의 대륙 본토만 포함. 호주 본토 포함, 섬·육지 포함 미확인 좌표 제외.',countryCount:new Set(destinations.map(p=>p.countryCode)).size,regionCount:new Set(destinations.map(p=>p.countryCode+':'+p.area)).size},note:'본토 도시 후보 목록. 여행경보는 추첨할 때 외교부 공개 지도에서 별도로 확인.',destinations};
fs.writeFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url),JSON.stringify(result));
console.log({destinations:destinations.length,...result.selection,excluded:counts});
