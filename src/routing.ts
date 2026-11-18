import type { Point, RoadSegment } from './contracts';
import { FixturePortError, roadLengthPx, type MapSource, type RouteQuery, type RouteResult } from './fixture-port';

interface Arc {
  to: string;
  road: RoadSegment;
  length: number;
  reverse: boolean;
}

interface Path {
  nodeIds: string[];
  arcs: Arc[];
  length: number;
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePath(a: Path, b: Path): number {
  if (a.length !== b.length) return a.length - b.length;
  for (const [index, arc] of a.arcs.entries()) {
    const other = b.arcs[index];
    if (!other) return 1;
    const order = compareId(arc.road.id, other.road.id);
    if (order !== 0) return order;
  }
  return a.arcs.length - b.arcs.length;
}

function buildGraph(source: MapSource, snapshot?: readonly RoadSegment[]): Map<string, Arc[]> {
  const graph = new Map<string, Arc[]>();
  for (const { id } of [...source.buildings, ...source.junctions]) {
    if (graph.has(id)) throw new FixturePortError('MAP_DUPLICATE_NODE_ID', id, '路网节点 id 重复');
    graph.set(id, []);
  }

  const mapRoadIds = new Set<string>();
  for (const { id } of source.road_segments) {
    if (mapRoadIds.has(id)) throw new FixturePortError('MAP_DUPLICATE_ROAD_ID', id, '初始路段 id 重复');
    mapRoadIds.add(id);
  }

  const endpoints = new Map<string, Point>();
  function recordEndpoint(id: string, point: Point, roadId: string): void {
    const previous = endpoints.get(id);
    if (previous && (previous.x !== point.x || previous.y !== point.y)) {
      throw new FixturePortError('MAP_ENDPOINT_MISMATCH', id, `路段 ${roadId} 与该节点的其他路段连接点不一致`);
    }
    endpoints.set(id, point);
  }

  const roads = [...(snapshot ?? source.road_segments)].sort((a, b) => compareId(a.id, b.id));
  const seenRoads = new Set<string>();
  for (const road of roads) {
    if (seenRoads.has(road.id)) throw new FixturePortError('MAP_DUPLICATE_ROAD_ID', road.id, '快照路段 id 重复');
    if (!mapRoadIds.has(road.id)) throw new FixturePortError('MAP_ROAD_SET_MISMATCH', road.id, '快照包含未知路段');
    seenRoads.add(road.id);
    const from = graph.get(road.from);
    const to = graph.get(road.to);
    if (!from || !to) throw new FixturePortError('MAP_UNKNOWN_ENDPOINT', road.id, '路段引用未知节点');
    if (road.from === road.to) throw new FixturePortError('MAP_SAME_ENDPOINTS', road.id, '路段起终点相同');

    const length = roadLengthPx(road);
    recordEndpoint(road.from, road.geometry[0]!, road.id);
    recordEndpoint(road.to, road.geometry[road.geometry.length - 1]!, road.id);
    if (road.blocked || road.hazard !== null) continue;
    from.push({ to: road.to, road, length, reverse: false });
    to.push({ to: road.from, road, length, reverse: true });
  }
  for (const id of mapRoadIds) {
    if (!seenRoads.has(id)) throw new FixturePortError('MAP_ROAD_SET_MISMATCH', id, '快照缺少路段');
  }
  return graph;
}

/** 双向 Dijkstra；等长路径按路段 ID 序列字典序取最小值。 */
export function findRoute(source: MapSource, query: RouteQuery): RouteResult {
  const { from_node_id: from, to_node_id: to, at_sim } = query;
  const graph = buildGraph(source, query.road_segments);
  const result = { from_node_id: from, to_node_id: to, at_sim };
  const unknown = [from, to].find((id) => !graph.has(id));
  if (unknown !== undefined) return { ...result, status: 'unreachable', reason: `未知路网节点：${unknown}` };

  const candidates = new Map<string, Path>([[from, { nodeIds: [from], arcs: [], length: 0 }]]);
  const settled = new Set<string>();
  while (candidates.size > 0) {
    const [node, path] = [...candidates].sort(([idA, a], [idB, b]) =>
      comparePath(a, b) || compareId(idA, idB),
    )[0]!;
    if (node === to) {
      const points = path.arcs.flatMap(({ road, reverse }, index) => {
        const geometry = reverse ? [...road.geometry].reverse() : road.geometry;
        return geometry.slice(index === 0 ? 0 : 1).map(({ x, y }) => ({ x, y }));
      });
      return {
        ...result,
        status: 'ready',
        node_ids: path.nodeIds,
        road_ids: path.arcs.map(({ road }) => road.id),
        points,
        length_px: path.length,
      };
    }

    candidates.delete(node);
    settled.add(node);
    for (const arc of graph.get(node)!) {
      if (settled.has(arc.to)) continue;
      const candidate = {
        nodeIds: [...path.nodeIds, arc.to],
        arcs: [...path.arcs, arc],
        length: path.length + arc.length,
      };
      if (!Number.isFinite(candidate.length)) {
        throw new FixturePortError('MAP_INVALID_GEOMETRY', arc.road.id, '路径总长必须有限');
      }
      const previous = candidates.get(arc.to);
      if (!previous || comparePath(candidate, previous) < 0) candidates.set(arc.to, candidate);
    }
  }
  return { ...result, status: 'unreachable', reason: '当前路网无可通行路径' };
}
