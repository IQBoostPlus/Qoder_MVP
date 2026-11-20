import type { Point, RoadSegment } from '../contracts';
import type { RouteResult } from '../fixture-port';

// 江宁训练地图的排版折点。路段身份、起止点与评分所用长度取自引擎数据。
type Bends = { from: Point; to: Point; via: readonly Point[] };
function bends(from: [number, number], to: [number, number], ...via: [number, number][]): Bends {
  const point = ([x, y]: [number, number]) => ({ x, y });
  return { from: point(from), to: point(to), via: via.map(point) };
}

const CAMPUS_BENDS: Readonly<Record<string, Bends>> = {
  'R-N7-N1': bends([380, 520], [180, 500], [402, 500], [402, 433], [209, 433], [209, 483]),
  'R-N1-N2': bends([180, 500], [120, 380], [191, 466], [191, 411], [141, 397]),
  'R-N2-CN1': bends([120, 380], [360, 330], [146, 403], [366, 403], [381, 385], [381, 355]),
  'R-CN2-SAC': bends([430, 330], [600, 190], [416, 312], [416, 230], [600, 230]),
  'R-SA-SY': bends([585, 695], [835, 695], [630, 695], [630, 601], [855, 601], [855, 671]),
  'R-EA-G3': bends([1000, 525], [930, 695], [1020, 550], [1000, 615], [910, 615], [910, 670]),
  'R-SY-ADM': bends([835, 695], [720, 860], [850, 780], [743, 780], [743, 828]),
  'R-G8-CLI': bends([1155, 695], [925, 860], [1146, 780], [1124, 801], [901, 801], [901, 827]),
  'R-WL-EA': bends([1000, 355], [1000, 525], [1095, 381], [1095, 501], [1081, 529], [1065, 533]),
  'R-E1-E7': bends([1210, 370], [1210, 210], [1150, 387], [1122, 367], [1122, 252], [1147, 225], [1210, 225]),
  'R-CE1-GATE4': bends([1140, 495], [1350, 495], [1131, 554], [1150, 578], [1350, 578]),
  'R-CE1-G8': bends([1140, 495], [1155, 695], [1109, 542], [1099, 606], [1111, 665], [1134, 695]),
};

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function roadDrawingPoints(road: RoadSegment): readonly Point[] {
  const drawing = CAMPUS_BENDS[road.id];
  const from = road.geometry[0];
  const to = road.geometry.at(-1);
  if (!drawing || !from || !to || !samePoint(from, drawing.from) || !samePoint(to, drawing.to)) {
    return road.geometry;
  }
  return [from, ...drawing.via, to];
}

export function routeDrawingPoints(
  route: Extract<RouteResult, { status: 'ready' }>,
  roads: ReadonlyMap<string, RoadSegment>,
): readonly Point[] {
  const points: Point[] = [];
  for (const [i, id] of route.road_ids.entries()) {
    const road = roads.get(id);
    if (!road) return route.points;
    const start = route.node_ids[i];
    const finish = route.node_ids[i + 1];
    const forward = road.from === start && road.to === finish;
    if (!forward && !(road.to === start && road.from === finish)) return route.points;
    const line = roadDrawingPoints(road);
    for (const point of forward ? line : [...line].reverse()) {
      const last = points.at(-1);
      if (!last || !samePoint(last, point)) points.push(point);
    }
  }
  return points.length > 1 ? points : route.points;
}
