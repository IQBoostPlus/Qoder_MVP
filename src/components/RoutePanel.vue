<script setup lang="ts">
import { computed } from 'vue';
import type { MapView, RoadStatus, RouteQuery, RouteResult } from '../fixture-port';
import { ROUTE_PENDING_TEXT, ROUTE_UNREACHABLE_TEXT } from '../fixture-port';
import { HAZARD_LABEL } from '../config/categories';
import { endpointName } from '../config/route-query';
import { simStamp } from '../config/format';

const props = withDefaults(
  defineProps<{
    route: RouteResult | null;
    query?: RouteQuery | null;
    map?: MapView | null;
    roads?: readonly RoadStatus[];
    technical?: boolean;
  }>(),
  { query: null, map: null, roads: () => [], technical: false },
);

const ready = computed(() => (props.route?.status === 'ready' ? props.route : null));
const unreachable = computed(() => (props.route?.status === 'unreachable' ? props.route : null));

const segmentRows = computed(() =>
  (ready.value?.road_ids ?? []).map((id) => {
    const st = props.roads.find((r) => r.road_id === id);
    const seg = props.map?.road_segments.find((r) => r.id === id);
    return {
      id,
      name: seg?.name ?? id,
      closed: st?.formally_closed ?? false,
      hazard: st?.hazard ?? null,
    };
  }),
);

const nodeChain = computed(() =>
  (ready.value?.node_ids ?? []).map((id) => (props.map ? endpointName(props.map, id) : id)).join(' → '),
);

function fromName(id: string): string {
  return props.map ? endpointName(props.map, id) : id;
}
</script>

<template>
  <div class="route-panel">
    <!-- null：等待查询或使用 D1 静态入口 -->
    <div v-if="route === null" class="empty-state blue" id="route-pending">
      <svg class="es-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="3" cy="8" r="2" />
        <circle cx="13" cy="8" r="2" />
        <path d="M5.5 8h5" stroke-dasharray="2 2" />
      </svg>
      <span>{{ query ? ROUTE_PENDING_TEXT : '请选择起终点' }}</span>
    </div>

    <!-- unreachable：已计算但不可达，灰色虚线风格，与 null 的文案和颜色都区分 -->
    <div v-else-if="route.status === 'unreachable'" class="empty-state unreachable" id="route-unreachable">
      <svg class="es-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M4 12 12 4" />
      </svg>
      <span>{{ ROUTE_UNREACHABLE_TEXT }}</span>
    </div>

    <!-- ready：明细 + 路段状态联动；路径线由 CampusMap 独立图层绘制 -->
    <div v-else class="route-ready" id="route-ready">
      <div class="route-head">
        <span class="route-ends">{{ fromName(route.from_node_id) }} → {{ fromName(route.to_node_id) }}</span>
        <span v-if="technical" class="badge badge-green badge-sm">ready @{{ route.at_sim }}</span>
        <span v-else class="badge badge-green badge-sm">已算出可通行路线</span>
      </div>
      <span v-if="technical" class="mono route-sum">{{ route.road_ids.length }} 段 · 路网计算长度 {{ route.length_px.toFixed(1) }} px</span>
      <span v-else class="route-sum">共 {{ route.road_ids.length }} 段路（图上示意 · 非实际距离）</span>
      <span class="note route-chain">{{ nodeChain }}</span>
      <ul class="route-segs">
        <li v-for="seg in segmentRows" :key="seg.id" class="route-seg">
          <span v-if="technical" class="mono seg-id">{{ seg.id }}</span>
          <span class="seg-name">{{ seg.name }}</span>
          <span v-if="seg.closed" class="badge badge-red badge-sm">封闭</span>
          <span v-else-if="seg.hazard !== null" class="badge badge-blue badge-sm">{{ HAZARD_LABEL[seg.hazard] }}</span>
          <span v-else class="badge badge-green badge-sm">通行</span>
        </li>
      </ul>
      <p v-if="technical && query" class="note mono route-query">
        query 携带 {{ query.road_segments?.length ?? 0 }} 条快照路段状态（blocked / hazard 分开传递）
      </p>
    </div>

    <p v-if="route === null && query === null" class="note">选择路径终点后发起查询；起终点相同时禁用查询。</p>
    <p v-else-if="route === null && technical" class="note mono">
      query: {{ query?.from_node_id }} → {{ query?.to_node_id }} @ t={{ query?.at_sim }}
    </p>
    <p v-else-if="route === null && query" class="note">
      查询：{{ fromName(query.from_node_id) }} → {{ fromName(query.to_node_id) }} · {{ simStamp(query.at_sim) }}
    </p>
    <p v-else-if="unreachable && technical" class="note mono">reason: {{ unreachable.reason }}</p>
    <p v-else-if="unreachable" class="note">不可达原因：{{ unreachable.reason }}</p>
  </div>
</template>

<style scoped>
.route-panel { display: flex; flex-direction: column; gap: 8px; }
.es-icon { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.empty-state.unreachable {
  border: 1px dashed var(--muted);
  background: var(--ink-800);
  color: var(--muted);
}
.route-ready { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.route-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.route-ends { font-weight: 700; font-size: 13px; }
.route-sum { font-size: 12.5px; color: var(--paper); font-variant-numeric: tabular-nums; }
.route-chain { margin: 0; }
.route-segs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.route-seg { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--ink-950); border: 1px solid var(--line-soft); border-radius: var(--r-sm); }
.seg-id { font-size: 11px; color: var(--muted); }
.seg-name { flex: 1; min-width: 0; font-size: 12px; }
.route-query { margin: 0; }
</style>
