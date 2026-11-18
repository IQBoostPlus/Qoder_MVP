<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MapView, RoadStatus } from '../fixture-port';
import type { ActionDef, ActionId } from '../contracts';
import { CATEGORY_STYLE, HAZARD_LABEL } from '../config/categories';
import { cordonText, rescueText, type MapOverlay, type Selection } from '../config/layers';
import { endpointName } from '../config/route-query';

const props = defineProps<{
  selection: Selection | null;
  map: MapView;
  roads: readonly RoadStatus[];
  overlay: MapOverlay;
  /** 推演页传入动作目录时显示临时提交入口；示例回放不传，保持只读。 */
  actions?: readonly ActionDef[];
}>();

const emit = defineEmits<{
  (e: 'jump', tSim: number): void;
  (e: 'endpoint', id: string, role: 'from' | 'to'): void;
  (e: 'action', actionId: ActionId, targetId: string): void;
}>();

const actionChoice = ref<ActionId | ''>('');
watch(
  () => props.selection,
  () => {
    actionChoice.value = '';
  },
);
const actionChoices = computed<readonly ActionDef[]>(() => {
  if (!props.actions || !props.selection || props.selection.kind === 'junction') return [];
  const kind = props.selection.kind === 'road' ? 'road' : 'building';
  return props.actions.filter((action) => action.target_kind === kind);
});
function emitAction(): void {
  if (actionChoice.value === '' || !props.selection) return;
  emit('action', actionChoice.value, props.selection.id);
}

const building = computed(() =>
  props.selection?.kind === 'building' ? props.map.buildings.find((b) => b.id === props.selection?.id) ?? null : null,
);
const road = computed(() =>
  props.selection?.kind === 'road' ? props.map.road_segments.find((r) => r.id === props.selection?.id) ?? null : null,
);
const roadStatus = computed(() =>
  props.selection?.kind === 'road' ? props.roads.find((r) => r.road_id === props.selection?.id) ?? null : null,
);
const junction = computed(() =>
  props.selection?.kind === 'junction' ? props.map.junctions.find((j) => j.id === props.selection?.id) ?? null : null,
);

const adjacencyNames = computed(() =>
  (building.value?.adjacency ?? []).map((id) => endpointName(props.map, id)).join('、') || '无',
);
const linkedRoads = computed(() =>
  props.selection === null
    ? []
    : props.map.road_segments.filter((r) => r.from === props.selection?.id || r.to === props.selection?.id),
);
const buildingMarks = computed(() => {
  const id = building.value?.id;
  if (id === undefined) return null;
  return {
    disaster: props.overlay.disaster.find((m) => m.building_id === id) ?? null,
    cordon: props.overlay.cordons.find((m) => m.building_id === id) ?? null,
    rescue: props.overlay.rescues.find((m) => m.building_id === id) ?? null,
  };
});
</script>

<template>
  <div class="detail" id="object-detail">
    <div v-if="selection === null" class="detail-empty">
      在图上点选楼栋 / 路段 / 路口查看详情；键盘 Tab 遍历、Enter 或 Space 选中、Esc 或点空白取消。
    </div>

    <!-- 楼栋 -->
    <template v-else-if="building">
      <div class="detail-head">
        <span class="detail-name">{{ building.name }}</span>
        <span class="badge badge-amber badge-sm">楼栋 · 已选中</span>
      </div>
      <div class="kv-row">
        <div class="kv"><span class="kv-k">分区</span><span class="kv-v">{{ building.zone }}</span></div>
        <div class="kv"><span class="kv-k">类别</span><span class="kv-v">{{ CATEGORY_STYLE[building.category].label }}</span></div>
        <div class="kv"><span class="kv-k">层数</span><span class="kv-v mono">{{ building.floors === null ? '通高' : `${building.floors} 层` }}</span></div>
        <div class="kv"><span class="kv-k">估算容量</span><span class="kv-v mono">≈{{ building.capacity }}</span></div>
      </div>
      <p class="detail-line">风险标注：{{ building.risk_tag ?? '无' }}</p>
      <p class="detail-line">邻接楼栋：{{ adjacencyNames }}</p>
      <div class="detail-states">
        <p v-if="buildingMarks?.disaster" class="state-line c-blue">
          灾情：{{ buildingMarks.disaster.title }} @{{ buildingMarks.disaster.at_sim }}
        </p>
        <p v-if="buildingMarks?.cordon" class="state-line c-amber">{{ cordonText(buildingMarks.cordon) }} · seq{{ buildingMarks.cordon.seq }}</p>
        <p v-if="buildingMarks?.rescue" class="state-line c-green">{{ rescueText(buildingMarks.rescue) }} · seq{{ buildingMarks.rescue.seq }}</p>
        <p v-if="!buildingMarks?.disaster && !buildingMarks?.cordon && !buildingMarks?.rescue" class="state-line dim">
          当前时刻无灾情 / 警戒 / 救援队标记
        </p>
      </div>
      <p class="note">楼栋可作上报定位候选，也可作路径起点 / 终点。</p>
      <div class="detail-actions">
        <button class="btn" @click="emit('endpoint', building.id, 'from')">设为路径起点</button>
        <button class="btn" @click="emit('endpoint', building.id, 'to')">设为路径终点</button>
      </div>
    </template>

    <!-- 路段 -->
    <template v-else-if="road">
      <div class="detail-head">
        <span class="detail-name">{{ road.name }}</span>
        <span class="badge badge-red badge-sm">路段 · 已选中</span>
      </div>
      <p class="detail-line mono">{{ road.id }} · {{ endpointName(map, road.from) }} → {{ endpointName(map, road.to) }}</p>
      <p class="detail-line">图上长度 {{ map.road_lengths_px[road.id]?.toFixed(1) ?? '—' }} px（非实际距离）</p>
      <div class="detail-states">
        <p class="state-line c-blue">
          自然灾情：
          <template v-if="roadStatus?.hazard">{{ HAZARD_LABEL[roadStatus.hazard] }} @{{ roadStatus.hazard_at_sim }}</template>
          <template v-else>无</template>
        </p>
        <p v-if="roadStatus?.hazard_description" class="state-line dim">{{ roadStatus.hazard_description }}</p>
        <p class="state-line c-red">
          正式封闭：
          <template v-if="roadStatus?.formally_closed">已封闭 @{{ roadStatus.closed_at_sim }} · seq{{ roadStatus.closed_by_action_seq }}</template>
          <template v-else>未封闭</template>
        </p>
        <p v-if="roadStatus?.block_reason" class="state-line dim">{{ roadStatus.block_reason }}</p>
      </div>
      <div class="detail-actions">
        <button
          v-if="roadStatus?.hazard_at_sim !== null && roadStatus?.hazard_at_sim !== undefined"
          class="btn"
          @click="emit('jump', roadStatus.hazard_at_sim)"
        >跳到灾情时刻 @{{ roadStatus.hazard_at_sim }}</button>
        <button
          v-if="roadStatus?.closed_at_sim !== null && roadStatus?.closed_at_sim !== undefined"
          class="btn"
          @click="emit('jump', roadStatus.closed_at_sim)"
        >跳到封闭时刻 @{{ roadStatus.closed_at_sim }}</button>
      </div>
      <p class="note">路段不可作为上报定位候选（JW-09）；「路段封闭」与「楼栋定位」是两个独立展示，互不覆盖（RE-07）。</p>
    </template>

    <!-- 路口 -->
    <template v-else-if="junction">
      <div class="detail-head">
        <span class="detail-name">{{ junction.name }}</span>
        <span class="badge badge-muted badge-sm">路口 · 非楼栋 · 已选中</span>
      </div>
      <p class="detail-line">类型：{{ junction.kind === 'gate' ? '校门' : '路口' }} · 路网节点，不计入楼栋数</p>
      <p class="detail-line">连接路段：{{ linkedRoads.map((r) => r.name).join('、') || '无' }}</p>
      <p class="note">路口可作路径起点 / 终点；不可作上报定位候选，也不作动作对象。</p>
      <div class="detail-actions">
        <button class="btn" @click="emit('endpoint', junction.id, 'from')">设为路径起点</button>
        <button class="btn" @click="emit('endpoint', junction.id, 'to')">设为路径终点</button>
      </div>
    </template>

    <!-- 推演页临时提交入口：对象按 target_kind 匹配动作（A5→路段，其余→楼栋；路口无动作） -->
    <template v-if="actionChoices.length > 0">
      <div class="detail-actions">
        <label class="control action-control">
          <span class="control-label">动作</span>
          <select v-model="actionChoice" aria-label="选择处置动作">
            <option value="" disabled>请选择</option>
            <option v-for="a in actionChoices" :key="a.id" :value="a.id">
              {{ a.id }} {{ a.name }} · {{ a.duration_sim }}s
            </option>
          </select>
        </label>
        <button class="btn" :disabled="actionChoice === ''" @click="emitAction">提交动作（临时）</button>
      </div>
      <p class="note">提交时刻 = 当前回合节点 t_sim（FR-4.7）；合法性由 A 规则引擎判定，未接入时记「待引擎接入」，不预设通过或拒绝。</p>
    </template>
  </div>
</template>

<style scoped>
.detail { display: flex; flex-direction: column; gap: 8px; }
.detail-empty { font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-name { font-size: 15px; font-weight: 700; }
.detail-line { margin: 0; font-size: 12.5px; color: var(--paper); }
.detail-line.mono { font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); }
.detail-states { display: flex; flex-direction: column; gap: 4px; }
.state-line { margin: 0; font-size: 12.5px; font-weight: 600; }
.state-line.dim { color: var(--muted); font-weight: 400; }
.c-blue { color: var(--blue); }
.c-red { color: var(--red); }
.c-amber { color: var(--amber); }
.c-green { color: var(--green); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.detail-actions .btn { min-height: 44px; padding: 6px 12px; font-size: 12.5px; }
.action-control { flex: 1 1 180px; min-width: 0; min-height: 44px; }
.action-control select { flex: 1; min-width: 0; }
</style>