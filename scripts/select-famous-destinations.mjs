// 한국 여행자에게 알려진 도시를 편집 선정한 목록. 공식 인기 순위는 아니에요.
// 실행: node scripts/select-famous-destinations.mjs <본토 후보 JSON>
import fs from 'node:fs';
const source=JSON.parse(fs.readFileSync(process.argv[2]));
const selections={
  KOR:'Seoul|Busan|Incheon|Daegu|Daejeon|Gwangju|Ulsan|Jeonju|Gangneung|Sokcho|Pohang|Suncheon|Gyeongju|Yeosu|Chuncheon',
  CHN:"Beijing|Shanghai|Guangzhou|Shenzhen|Chengdu|Xian|Xi'an|Hangzhou|Suzhou|Nanjing|Qingdao|Dalian|Guilin|Kunming|Zhangjiajie|Xiamen|Tianjin|Chongqing|Harbin|Lijiang|Huangshan",
  VNM:'Hanoi|Ho Chi Minh City|Da Nang|Hoi An|Hue|Nha Trang|Da Lat|Sapa|Ha Long',
  THA:'Bangkok|Chiang Mai|Chiang Rai|Pattaya|Hua Hin|Krabi|Ayutthaya',
  MYS:'Kuala Lumpur|Malacca|Melaka|Ipoh|Johor Bahru',
  KHM:'Siem Reap|Phnom Penh',LAO:'Vientiane|Luang Prabang|Vang Vieng',MNG:'Ulaanbaatar',NPL:'Kathmandu|Pokhara',BTN:'Thimphu|Paro',
  IND:'New Delhi|Delhi|Mumbai|Jaipur|Agra|Varanasi|Udaipur|Jodhpur|Kochi|Panaji|Bangalore',
  TUR:'Istanbul|Ankara|Antalya|Izmir|Bodrum|Konya',GEO:'Tbilisi|Batumi',ARM:'Yerevan',AZE:'Baku',UZB:'Tashkent|Samarkand|Bukhara',KAZ:'Almaty|Astana',KGZ:'Bishkek',
  FRA:'Paris|Nice|Lyon|Marseille|Avignon|Strasbourg|Bordeaux|Annecy|Toulouse|Chamonix',
  DEU:'Berlin|Munich|Frankfurt|Cologne|Hamburg|Dusseldorf|Dresden|Heidelberg|Nuremberg|Stuttgart|Rothenburg ob der Tauber',
  ITA:'Rome|Milan|Florence|Naples|Turin|Bologna|Verona|Pisa|Siena|Lucca',
  ESP:'Madrid|Barcelona|Seville|Granada|Malaga|Valencia|Cordoba|Toledo|Segovia|Bilbao|San Sebastian|Zaragoza|Alicante|Ronda',
  PRT:'Lisbon|Porto|Faro|Coimbra|Aveiro|Sintra',CHE:'Zurich|Geneva|Lucerne|Interlaken|Bern|Basel|Lausanne|Zermatt|Grindelwald|Lauterbrunnen',
  AUT:'Vienna|Salzburg|Innsbruck|Graz|Hallstatt',CZE:'Prague|Cesky Krumlov|Brno|Karlovy Vary',HUN:'Budapest',SVK:'Bratislava',
  POL:'Warsaw|Krakow|Wroclaw|Gdansk|Poznan',SVN:'Ljubljana|Bled',HRV:'Zagreb|Dubrovnik|Split|Zadar',MNE:'Kotor|Budva|Podgorica',BIH:'Sarajevo|Mostar',SRB:'Belgrade',
  BEL:'Brussels|Brugge|Bruges|Ghent|Antwerp',NLD:'Amsterdam|Rotterdam|The Hague|Utrecht|Delft',NOR:'Oslo|Bergen|Tromso|Stavanger',
  SWE:'Stockholm|Gothenburg|Malmo',FIN:'Helsinki|Rovaniemi|Turku',DNK:'Aarhus|Aalborg',GRC:'Athens|Thessaloniki',ROU:'Bucharest|Brasov',BGR:'Sofia',
  USA:'Los Angeles|San Francisco|San Diego|Las Vegas|Seattle|Portland|Chicago|Boston|Miami|Washington, D.C.|Washington|Denver|Houston|Dallas|Austin|Orlando|Atlanta|Philadelphia|Phoenix|Salt Lake City|New Orleans',
  CAN:'Vancouver|Toronto|Montreal|Quebec|Quebec City|Ottawa|Calgary|Banff|Jasper|Niagara Falls',
  AUS:'Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Gold Coast|Cairns|Darwin|Alice Springs',
  MEX:'Mexico City|Cancun|Guadalajara|Oaxaca|Merida|Puebla|San Miguel de Allende|Puerto Vallarta',PER:'Lima|Cusco|Arequipa',BOL:'La Paz|Uyuni|Sucre',
  CHL:'Santiago|San Pedro de Atacama|Punta Arenas',ARG:'Buenos Aires|Mendoza|Bariloche|El Calafate',BRA:'Rio de Janeiro|Sao Paulo|Foz do Iguacu',URY:'Montevideo',
  CRI:'San Jose|La Fortuna',PAN:'Panama City',COL:'Bogota|Medellin|Cartagena',ECU:'Quito|Cuenca|Guayaquil',
};
const normalize=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const wanted=new Map(Object.entries(selections).map(([c,names])=>[c,new Set(names.split('|').map(normalize))]));
const destinations=source.destinations.filter(p=>wanted.get(p.countryCode)?.has(normalize(p.cityEn)))
  .filter(p=>!(p.countryCode==='USA'&&p.cityEn==='Portland'&&p.area!=='Oregon'))
  .filter(p=>!(p.countryCode==='CHN'&&p.cityEn==='Suzhou'&&p.area!=='Jiangsu'))
  .map(p=>({...p,curation:'korean-traveler-famous-city'}));
const result={source:source.source,selection:{curated:true,curation:'한국 여행자에게 익숙한 유명 도시를 편집 선정한 목록 (공식 순위·전수 목록 아님)',mainlandOnly:true,excludedContinents:['Africa'],countryCount:new Set(destinations.map(p=>p.countryCode)).size},note:'편집 선정된 유명 도시 중 아프리카·섬 제외. 추첨할 때 외교부 여행경보를 별도로 확인.',destinations};
fs.writeFileSync(new URL('../public/assets/data/world-destinations.json',import.meta.url),JSON.stringify(result));
console.log({cities:destinations.length,countries:result.selection.countryCount,list:destinations.map(p=>p.country+': '+p.city).join(', ')});
