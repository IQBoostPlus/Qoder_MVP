import assert from 'node:assert/strict';
import baseJson from '../fixtures/buildings.json';
import campusJson from '../fixtures/campus-map.json';
import type { Point, RoadSegment } from '../src/contracts';
import { useFixtureData, useFixturePort } from '../src/composables/useFixturePort';
import { formatBuildingFloors } from '../src/config/categories';
import { buildRouteQuery, endpointOptions, locationOptions } from '../src/config/route-query';
import { createEnginePort } from '../src/engine-port';
import { FixturePortError, roadLengthPx, type MapSource, type RouteResult } from '../src/fixture-port';
import { findRoute } from '../src/routing';

function ready(result: RouteResult | null) {
  assert.equal(result?.status, 'ready');
  return result;
}

const campus: MapSource = campusJson as MapSource;
const fixture = useFixtureData();
const port = useFixturePort();
const { map } = port;
const initialData = structuredClone(campus);
const ids = campus.buildings.map((building) => building.id);
assert.deepEqual(ids.sort(), 'N7 N1 N2 N11 E1 E7 CN1 CN2 CE1 GYM SY G3 G8 LIB ADM SA EA WL CLI SAC'.split(' ').sort());
assert.deepEqual(campus.junctions.map(({ id }) => id).sort(), ['GATE3', 'GATE4', 'GATES']);
assert.ok(campus.junctions.every(({ kind }) => kind === 'gate'));
assert.equal(campusJson.schema_version, 'd2-1');
assert.deepEqual(map.buildings, campus.buildings);
assert.deepEqual(map.junctions, campus.junctions);
assert.deepEqual(map.road_segments, campus.road_segments);
for (const [id, expectedFloors, label] of [
  ['CLI', null, '未公开'],
  ['GYM', null, '通高'],
  ['N7', 5, '5 层'],
] as const) {
  const building = map.buildings.find((candidate) => candidate.id === id);
  assert.ok(building, id);
  assert.equal(building.floors, expectedFloors, id);
  assert.equal(formatBuildingFloors(building), label, id);
}
assert.equal(endpointOptions(map).length, 23);
assert.deepEqual(locationOptions(map).map(({ id }) => id).sort(), [...ids, '无法定位'].sort());

for (const { adjacency: _, ...base } of baseJson.buildings) {
  const { adjacency: __, ...actual } = map.buildings.find(({ id }) => id === base.id)!;
  assert.deepEqual(actual, base, base.id);
}
for (const base of baseJson.road_segments) {
  const { geometry, ...road } = map.road_segments.find(({ id }) => id === base.id)!;
  const { geometry: oldGeometry, ...oldRoad } = base;
  assert.deepEqual(road, oldRoad, base.id);
  assert.ok(geometry.some((_, index) =>
    oldGeometry.every((point, offset) => geometry[index + offset]?.x === point.x && geometry[index + offset]?.y === point.y),
  ), `${road.id} 须保留原始折线，可在首尾补齐接驳段`);
}
const anchors = new Map<string, Point>();
for (const road of map.road_segments) {
  assert.ok(!road.blocked && road.hazard === null, road.id);
  assert.ok(map.road_lengths_px[road.id]! > 0);
  for (const [id, point] of [[road.from, road.geometry.at(0)!], [road.to, road.geometry.at(-1)!]] as const) {
    if (anchors.has(id)) assert.deepEqual(anchors.get(id), point, `${id} 的连接点不一致`);
    anchors.set(id, point);
  }
}
for (const gate of map.junctions) {
  assert.deepEqual(map.junction_positions[gate.id], anchors.get(gate.id));
}
for (const building of map.buildings) {
  const neighbors = new Set<string>();
  for (const { from, to } of map.road_segments) {
    if (from === building.id && ids.includes(to)) neighbors.add(to);
    if (to === building.id && ids.includes(from)) neighbors.add(from);
  }
  assert.deepEqual(building.adjacency, [...neighbors].sort(), building.id);
}
for (const { id } of endpointOptions(map)) {
  ready(port.getRoute({ from_node_id: 'GATES', to_node_id: id, at_sim: 0 }));
}
const cross = ready(port.getRoute({ from_node_id: 'N7', to_node_id: 'GATE4', at_sim: 0 }));
assert.ok(cross.length_px > 120);
console.log(`CD-01/CD-04 数据与应用接口：${ids.length} 栋、${map.junctions.length} 门、${map.road_segments.length} 路段；23 节点连通、几何与邻接通过；北区 → 东门 ${cross.length_px.toFixed(1)} px`);

function edge(id: string, from: string, to: string, ...points: [number, number][]): RoadSegment {
  return { id, name: id, from, to, geometry: points.map(([x, y]) => ({ x, y })),
    blocked: false, hazard: null, block_reason: null };
}
const graph: MapSource = {
  buildings: [],
  junctions: ['S', 'L', 'R', 'T', 'Z'].map((id) => ({ id, name: id, kind: 'crossing' })),
  road_segments: [
    edge('direct-long', 'S', 'T', [0, 0], [0, 10], [4, 0]),
    edge('b1', 'S', 'L', [0, 0], [0, 2]),
    edge('b2', 'L', 'T', [0, 2], [2, 2], [4, 0]),
    edge('a1', 'S', 'R', [0, 0], [2, 0]),
    edge('a2', 'T', 'R', [4, 0], [4, 2], [2, 0]),
  ],
};
// 两条换乘路径均为 2 + 2 + sqrt(8)；直连边绕远，a2 沿反方向存储。
const q = { from_node_id: 'S', to_node_id: 'T', at_sim: 42 };
const graphBefore = structuredClone(graph);
const small = ready(findRoute(graph, q));
assert.deepEqual(small.road_ids, ['a1', 'a2']);
assert.deepEqual(small.node_ids, ['S', 'R', 'T']);
assert.deepEqual(small.points, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 0 }]);
assert.equal(small.length_px, 2 + (Math.sqrt(8) + 2));
assert.deepEqual(findRoute({ ...graph, road_segments: [...graph.road_segments].reverse() }, q), small);
const reverse = ready(findRoute(graph, { ...q, from_node_id: 'T', to_node_id: 'S' }));
assert.deepEqual(reverse.points, [...small.points].reverse());
assert.equal(reverse.length_px, small.length_px);
assert.deepEqual(ready(findRoute(graph, { ...q, to_node_id: 'S' })), {
  ...q, to_node_id: 'S', status: 'ready', node_ids: ['S'], road_ids: [], points: [], length_px: 0,
});
for (const [to_node_id, reason] of [['Z', /无可通行/], ['?', /未知路网节点/]] as const) {
  const result = findRoute(graph, { ...q, to_node_id });
  assert.equal(result.status, 'unreachable');
  assert.match(result.reason, reason);
}
assert.equal(findRoute(graph, { ...q, road_segments: graph.road_segments.map((road) => ({ ...road, blocked: true })) }).status, 'unreachable');
function mapError(code: string, roads: readonly RoadSegment[]): void {
  assert.throws(() => findRoute(graph, { ...q, road_segments: roads }), (error) =>
    error instanceof FixturePortError && error.code === code,
  );
}
const [direct, ...rest] = graph.road_segments;
mapError('MAP_INVALID_GEOMETRY', [{ ...direct!, geometry: [{ x: NaN, y: 0 }, { x: 4, y: 0 }] }, ...rest]);
mapError('MAP_ZERO_LENGTH', [{ ...direct!, geometry: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, ...rest]);
mapError('MAP_UNKNOWN_ENDPOINT', [{ ...direct!, to: '?' }, ...rest]);
mapError('MAP_ENDPOINT_MISMATCH', [{ ...direct!, geometry: [{ x: -1, y: 0 }, { x: 4, y: 0 }] }, ...rest]);
mapError('MAP_DUPLICATE_ROAD_ID', [...graph.road_segments, direct!]);
mapError('MAP_ROAD_SET_MISMATCH', rest);
mapError('MAP_ROAD_SET_MISMATCH', [{ ...direct!, id: 'extra' }, ...rest]);
assert.throws(() => findRoute({ ...graph, junctions: [...graph.junctions, graph.junctions[0]!] }, q),
  { code: 'MAP_DUPLICATE_NODE_ID' });
assert.deepEqual(graph, graphBefore);
console.log('小图 Dijkstra：最短、等长字典序、反向折线、零长、孤立、未知、全阻断及无效输入通过');

const runId = 'run-jia-1x';
const faster = createEnginePort({
  ...fixture, runs: fixture.runs.map((run) => ({ ...run, playback_speed: 4 })),
}, campus);
for (const [t, flooded, closed] of [[139, false, false], [140, true, false], [164, true, false], [165, true, true]] as const) {
  const snapshot = port.replayTo(runId, { t_sim: t });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.roads.map(({ road_id }) => road_id), map.road_segments.map(({ id }) => id));
  const backup = snapshot.roads.find(({ road_id }) => road_id === 'R-N1-GATE3');
  assert.ok(backup && !backup.formally_closed && backup.hazard === null);
  const query = buildRouteQuery(map, snapshot, 'N7', 'GATE3', t);
  assert.ok(query.road_segments);
  const n7e = query.road_segments.find(({ id }) => id === 'R-N7E');
  assert.equal(n7e?.hazard, flooded ? 'flood' : null);
  assert.equal(n7e?.blocked, closed);
  const result = ready(port.getRoute(query));
  const roads = flooded ? ['R-N7-N1', 'R-N1-GATE3'] : ['R-N7E'];
  assert.deepEqual(result.road_ids, roads);
  assert.deepEqual(result.node_ids, flooded ? ['N7', 'N1', 'GATE3'] : ['N7', 'GATE3']);
  assert.equal(result.at_sim, t);
  assert.equal(result.length_px, roads.reduce((sum, id) => sum + map.road_lengths_px[id]!, 0));
  assert.ok(Math.abs(roadLengthPx({ ...n7e!, geometry: result.points }) - result.length_px) < 1e-9);
  const fastSnapshot = faster.replayTo(runId, { t_sim: t });
  assert.equal(fastSnapshot?.playback_speed, 4);
  assert.deepEqual(faster.getRoute(buildRouteQuery(faster.map, fastSnapshot, 'N7', 'GATE3', t)), result);
  console.log(`RE-06 t=${t} hazard=${n7e?.hazard} blocked=${n7e?.blocked}: ${JSON.stringify(result)}`);
}
const original = buildRouteQuery(map, port.replayTo(runId, { t_sim: 165 }), 'N7', 'GATE3', 165);
const initial = port.replayTo(runId, { t_sim: 139 });
const withDefaultHazard = {
  ...map, road_segments: map.road_segments.map((road) =>
    road.id === 'R-N7E' ? { ...road, hazard: 'flood' as const } : road),
};
assert.equal(buildRouteQuery(withDefaultHazard, initial, 'N7', 'GATE3', 139)
  .road_segments?.find(({ id }) => id === 'R-N7E')?.hazard, null);
const closedGate = structuredClone(original);
for (const road of closedGate.road_segments!) {
  if (road.from === 'GATE3' || road.to === 'GATE3') road.blocked = true;
}
const isolated = port.getRoute(closedGate);
assert.equal(isolated?.status, 'unreachable');
assert.match(isolated.reason, /无可通行/);
assert.deepEqual(ready(port.getRoute(original)).road_ids, ['R-N7-N1', 'R-N1-GATE3']);
assert.deepEqual(ready(port.getRoute({ from_node_id: 'N7', to_node_id: 'GATE3', at_sim: 165 })).road_ids, ['R-N7E']);
for (const run of fixture.runs) {
  assert.deepEqual(port.getScore(run.run_id, run.events), fixture.expected_scores[run.run_id]);
  assert.equal(port.getScore(run.run_id, run.events.slice(1)), null);
}
assert.deepEqual(campus, initialData);
assert.deepEqual(map.road_segments, initialData.road_segments);
console.log('GATE3 全封闭 → unreachable；恢复 → ready；省略快照 → 初始直达；1×/4× 一致；静态评分及输入保持');
console.log('D2 routing and integration validation PASSED');
