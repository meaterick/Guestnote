// 같은 넓이의 땅은 같은 확률로 뽑아요. 원통 등적 투영으로 위도에 따른 면적 차이를 보정해요.
const RAD = Math.PI / 180;
const COS = Math.cos(36 * RAD);
export const project = ([lon, lat]) => [(lon - 128) * COS, (Math.sin(36 * RAD) - Math.sin(lat * RAD)) / RAD / COS];
export const unproject = ([x, y]) => [128 + x / COS, Math.asin(Math.sin(36 * RAD) - y * RAD * COS) / RAD];

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
export const inPolygon = (point, rings) => inRing(point, rings[0]) && !rings.slice(1).some(r => inRing(point, r));

function boundsOf(ring) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x,y] of ring) { b[0]=Math.min(b[0],x); b[1]=Math.min(b[1],y); b[2]=Math.max(b[2],x); b[3]=Math.max(b[3],y); }
  return b;
}
const inBounds = ([x,y], b) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3];

// 추첨과 애니메이션은 지도에 그린 것과 같은 육지 데이터를 사용해요.
export function createLandSampler(collection) {
  const polygons = [];
  const regions = collection.features.map(f => {
    const geometries = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const region = { ...f.properties, polygons: geometries.map(p => p.map(r => r.map(project))) };
    for (const rings of region.polygons) polygons.push({ region, rings, bounds: boundsOf(rings[0]) });
    return region;
  });
  let total = 0;
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polygons) {
    const [a,b,c,d] = p.bounds;
    total += (c-a)*(d-b); p.end = total;
    bounds[0]=Math.min(bounds[0],a); bounds[1]=Math.min(bounds[1],b); bounds[2]=Math.max(bounds[2],c); bounds[3]=Math.max(bounds[3],d);
  }
  if (!polygons.length || !(total > 0)) throw new Error('지도 데이터가 비어 있어요.');
  const regionAt = point => polygons.find(p => inBounds(point,p.bounds) && inPolygon(point,p.rings))?.region ?? null;
  return {
    regions, polygons, bounds,
    regionAt: lonLat => regionAt(project(lonLat)),
    sample(random = Math.random) {
      // 바운딩 박스 넓이만큼 고른 뒤 실제 육지가 아니면 다시 뽑는 rejection sampling.
      // 작은 섬도 제외하지 않고, 각 폴리곤의 구멍(호수 등)은 제외해요.
      for (let attempt=0; attempt<100000; attempt++) {
        const target = random()*total;
        const p = polygons.find(p => target < p.end) ?? polygons.at(-1);
        const [a,b,c,d] = p.bounds;
        const xy = [a + random()*(c-a), b + random()*(d-b)];
        if (inPolygon(xy,p.rings)) {
          const [lon,lat] = unproject(xy);
          return { lon, lat, xy, region: p.region };
        }
      }
      throw new Error('위치를 고르지 못했어요. 다시 시도해 주세요.');
    },
  };
}

// 최종 결과는 브라우저의 난수로, 애니메이션 후보와 독립해서 한 번 뽑아요.
export function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}
