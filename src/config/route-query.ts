import type { MapView, RoundSnapshot, RouteQuery } from '../fixture-port';
import type { Unlocatable } from '../contracts';

export const UNLOCATABLE: Unlocatable = '无法定位';

export interface EndpointOption {
  id: string;
  name: string;
  kind: 'building' | 'junction';
  note: string;
}

/** 路径端点候选 = 楼栋 + 路口；路口显式标注非楼栋。不做 junctions[0] 之类位置假设。 */
export function endpointOptions(map: MapView): EndpointOption[] {
  return [
    ...map.buildings.map((b) => ({ id: b.id, name: b.name, kind: 'building' as const, note: '楼栋' })),
    ...map.junctions.map((j) => ({
      id: j.id,
      name: j.name,
      kind: 'junction' as const,
      note: '路网节点·非楼栋',
    })),
  ];
}

/** 上报定位候选 = 楼栋 + 「无法定位」；绝不含路段与路口（JW-09）。 */
export function locationOptions(map: MapView): { id: string; name: string }[] {
  return [...map.buildings.map((b) => ({ id: b.id, name: b.name })), { id: UNLOCATABLE, name: UNLOCATABLE }];
}

/**
 * 携带按快照更新后的路网状态：blocked（正式封闭）与 hazard（自然灾情）分别忠实传递，
 * 是否把 hazard 视为不可通行由 A 的寻路决定。
 */
export function buildRouteQuery(
  map: MapView,
  snapshot: Pick<RoundSnapshot, 'roads'> | null,
  fromNodeId: string,
  toNodeId: string,
  atSim: number,
): RouteQuery {
  const statusById = new Map((snapshot?.roads ?? []).map((r) => [r.road_id, r]));
  return {
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    at_sim: atSim,
    road_segments: map.road_segments.map((seg) => {
      const st = statusById.get(seg.id);
      return {
        ...seg,
        blocked: st?.formally_closed ?? seg.blocked,
        hazard: st ? st.hazard : seg.hazard,
      };
    }),
  };
}

export function endpointName(map: MapView, id: string): string {
  return (
    map.buildings.find((b) => b.id === id)?.name ??
    map.junctions.find((j) => j.id === id)?.name ??
    map.road_segments.find((r) => r.id === id)?.name ??
    id
  );
}
