<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useFixturePort, useFixtureData } from '../composables/useFixturePort';
import { CATEGORY_STYLE, HAZARD_LABEL } from '../config/categories';
import {
  LAYER_ORDER,
  LAYER_STYLE,
  deriveLayerMarks,
  cordonText,
  rescueText,
  type LayerKey,
  type Selection,
  type SelectionKind,
} from '../config/layers';
import { buildRouteQuery, endpointOptions, endpointName } from '../config/route-query';
import CampusMap from '../components/CampusMap.vue';
import MapLegend from '../components/MapLegend.vue';
import RoutePanel from '../components/RoutePanel.vue';
import ScorePanel from '../components/ScorePanel.vue';
import ObjectDetail from '../components/ObjectDetail.vue';
import OccupancyBars from '../components/OccupancyBars.vue';

const port = useFixturePort();
const fixture = useFixtureData();
const map = port.map;

const runs = fixture.runs;
const runId = ref(runs[0]?.run_id ?? '');
const tEnd = fixture.scenario.t_end;
const t = ref(tEnd);
const dockTab = ref<'time' | 'roads' | 'route' | 'legend' | 'score'>('time');

// 选中与 hover 预览共用一套高亮：hovered 优先，其次 selected（触屏无 hover，点按是唯一通路）。
const hovered = ref<Selection | null>(null);
const selected = ref<Selection | null>(null);
const highlight = computed<Selection | null>(() => hovered.value ?? selected.value);
function toggleSelect(kind: SelectionKind, id: string): void {
  selected.value =
    selected.value?.kind === kind && selected.value.id === id ? null : { kind, id };
}
function clearSelection(): void {
  selected.value = null;
}
function onGlobalKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') clearSelection();
}
onMounted(() => window.addEventListener('keydown', onGlobalKey));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey));

// 三图层独立开关，默认全开；只影响视觉，不影响快照与评分。
const layers = ref<Record<LayerKey, boolean>>({ disaster: true, cordon: true, rescue: true });

// 剧本节点时刻（FR-4.7：操作时刻只能是节点值）。
const nodeTimes = [...new Set(fixture.scenario.nodes.map((n) => n.t_sim))].sort((a, b) => a - b);
// 140 / 164 / 165 非剧本节点成员，是道路双状态（积水→仍未封闭→正式封闭 seq17）的演示 affordance，
// 单独成组并标注来源，D3 动作提交不得把它们当作可操作时刻。
const demoTimes = [140, 164, 165];

const snapshot = computed(() => port.replayTo(runId.value, { t_sim: t.value }));
const roads = computed(() => snapshot.value?.roads ?? []);
// 交互路径恒传第二参数；完整匹配原始示例才返回分数，偏离即 null。
const score = computed(() => (snapshot.value ? port.getScore(runId.value, snapshot.value.events) : null));
const overlay = computed(() => deriveLayerMarks(snapshot.value));

// 路径起终点：显式用户选择，起点默认 scenario.start_building_id；不做 junctions[0] 位置假设。
const endpoints = endpointOptions(map);
const routeFrom = ref(fixture.scenario.start_building_id);
const routeTo = ref('');
const degenerate = computed(() => routeTo.value !== '' && routeFrom.value === routeTo.value);
const routeQuery = computed(() =>
  routeTo.value === '' || degenerate.value
    ? null
    : buildRouteQuery(map, snapshot.value, routeFrom.value, routeTo.value, t.value),
);
const route = computed(() => (routeQuery.value ? port.getRoute(routeQuery.value) : null));
function setEndpoint(id: string, role: 'from' | 'to'): void {
  if (role === 'from') routeFrom.value = id;
  else routeTo.value = id;
  dockTab.value = 'route';
}
function jumpTo(tSim: number): void {
  t.value = tSim;
  dockTab.value = 'time';
}

// 窄屏可读口径：图层态势文字清单（颜色 + 文字双通道）。
interface SituationEntry {
  key: string;
  color: string;
  text: string;
}
const situation = computed<SituationEntry[]>(() => {
  const list: SituationEntry[] = [];
  if (layers.value.disaster) {
    for (const m of overlay.value.disaster) {
      list.push({ key: `d-${m.building_id}`, color: 'var(--blue)', text: `${endpointName(map, m.building_id)} · 灾情：${m.title} @${m.at_sim}` });
    }
    for (const r of roads.value) {
      if (r.hazard !== null) {
        list.push({ key: `h-${r.road_id}`, color: 'var(--blue)', text: `${r.name} · ${HAZARD_LABEL[r.hazard]} @${r.hazard_at_sim}${r.formally_closed ? '' : '（未封闭）'}` });
      }
    }
  }
  if (layers.value.cordon) {
    for (const m of overlay.value.cordons) {
      list.push({ key: `c-${m.seq}`, color: 'var(--amber)', text: `${endpointName(map, m.building_id)} · ${cordonText(m)}` });
    }
  }
  if (layers.value.rescue) {
    for (const m of overlay.value.rescues) {
      list.push({ key: `r-${m.seq}`, color: 'var(--green)', text: `${endpointName(map, m.building_id)} · ${rescueText(m)}` });
    }
  }
  for (const r of roads.value) {
    if (r.formally_closed) {
      list.push({ key: `x-${r.road_id}`, color: 'var(--red)', text: `${r.name} · 已封闭 @${r.closed_at_sim} · seq${r.closed_by_action_seq}` });
    }
  }
  return list;
});

const currentRun = computed(() => runs.find((r) => r.run_id === runId.value));
const hazardCount = computed(() => roads.value.filter((r) => r.hazard !== null).length);
const closedCount = computed(() => roads.value.filter((r) => r.formally_closed).length);

function setT(value: number): void {
  t.value = value;
}
function resetSample(): void {
  runId.value = runs[0]?.run_id ?? '';
  t.value = tEnd;
}
</script>

<template>
  <section class="mapwrap">
    <!-- 地图舞台 + 常驻图层开关 -->
    <div class="stage-col">
      <div class="layer-bar" role="group" aria-label="图层开关">
        <button
          v-for="key in LAYER_ORDER"
          :key="key"
          class="layer-toggle"
          :class="{ on: layers[key] }"
          :aria-pressed="layers[key]"
          :style="{ '--layer-color': LAYER_STYLE[key].color, '--layer-soft': LAYER_STYLE[key].soft, '--layer-edge': LAYER_STYLE[key].edge }"
          @click="layers[key] = !layers[key]"
        >
          <span class="lt-dot" aria-hidden="true"></span>
          {{ LAYER_STYLE[key].label }}
          <span class="lt-state">{{ layers[key] ? '开' : '关' }}</span>
        </button>
        <button v-if="selected !== null" class="btn layer-clear" @click="clearSelection">取消选中</button>
      </div>

      <div class="map-stage">
        <CampusMap
          :map="map"
          :roads="roads"
          :highlight="highlight"
          :selected="selected"
          :overlay="overlay"
          :layers="layers"
          :route="route"
          @select="toggleSelect"
          @clear="clearSelection"
        />
        <div class="stage-frame"><i></i><i></i><i></i><i></i></div>

        <div class="hud hud-tl">
          <span class="hud-label">SIM CLOCK</span>
          <span class="hud-clock" id="snapshot-t">T+{{ snapshot?.t_sim ?? 0 }}<small>s</small></span>
          <span class="hud-line"><span class="dim">分支</span> {{ currentRun?.branch }} <span class="dim">·</span> {{ runId }}</span>
        </div>

        <div class="hud hud-tr">
          <span class="hud-label">NETWORK</span>
          <span class="hud-line" id="building-count">{{ map.buildings.length }} 栋 · {{ map.road_segments.length }} 路段 · {{ map.junctions.length }} 路口</span>
          <span class="hud-line dim">D1 子集 · D2 补至 20 栋零改动</span>
          <span class="hud-line dim">viewBox {{ map.view_box_svg }}</span>
        </div>

        <div class="hud hud-br">
          <span class="hud-label">ROAD STATUS</span>
          <span class="hud-line hud-pill">
            <span class="badge badge-blue badge-sm">灾情 {{ hazardCount }}</span>
            <span class="badge badge-red badge-sm">封闭 {{ closedCount }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 情报轨（桌面）/ 底部舱（移动） -->
    <aside class="rail" :data-active="dockTab">
      <div class="seg" role="tablist" aria-label="情报舱切换">
        <button :class="{ on: dockTab === 'time' }" @click="dockTab = 'time'">时间轴</button>
        <button :class="{ on: dockTab === 'roads' }" @click="dockTab = 'roads'">道路</button>
        <button :class="{ on: dockTab === 'route' }" @click="dockTab = 'route'">路径</button>
        <button :class="{ on: dockTab === 'legend' }" @click="dockTab = 'legend'">图例</button>
        <button :class="{ on: dockTab === 'score' }" @click="dockTab = 'score'">评分</button>
      </div>

      <section class="rail-sec sec-detail">
        <div class="rail-head"><span class="no">00</span><h2>对象详情</h2><span class="sub">select</span></div>
        <ObjectDetail :selection="selected" :map="map" :roads="roads" :overlay="overlay" @jump="jumpTo" @endpoint="setEndpoint" />
      </section>

      <section class="rail-sec sec-situation">
        <div class="rail-head"><span class="no">01</span><h2>当前态势</h2><span class="sub">snapshot</span></div>
        <ul v-if="situation.length" class="situation-list">
          <li v-for="entry in situation" :key="entry.key">
            <span class="sit-dot" :style="{ background: entry.color }" aria-hidden="true"></span>
            <span>{{ entry.text }}</span>
          </li>
        </ul>
        <p v-else class="note">当前时刻无灾情 / 警戒 / 救援队 / 封闭标记。试试 t=90 / 130 / 165。</p>
      </section>

      <section class="rail-sec sec-time">
        <div class="rail-head"><span class="no">02</span><h2>时间轴 · 道路双状态</h2><span class="sub">replayTo</span></div>
        <div class="controls">
          <label class="control">
            <span class="control-label">流水</span>
            <select v-model="runId" id="run-select" aria-label="选择推演流水">
              <option v-for="r in runs" :key="r.run_id" :value="r.run_id">{{ r.branch }} · {{ r.run_id }}</option>
            </select>
          </label>
          <button class="btn" id="reset-sample" @click="resetSample">载入原始示例</button>
        </div>
        <div class="slider-block">
          <div class="slider-row">
            <input type="range" id="timeline" v-model.number="t" :min="0" :max="tEnd" :step="1" aria-label="模拟时刻" />
            <span class="slider-value">{{ t }}s</span>
          </div>
          <div class="chip-group">
            <span class="chip-group-label">剧本节点</span>
            <div class="node-chips">
              <button v-for="time in nodeTimes" :key="time" class="chip" :class="{ active: t === time }" @click="setT(time)">{{ time }}</button>
            </div>
          </div>
          <div class="chip-group">
            <span class="chip-group-label">道路双状态演示时刻（非剧本节点）</span>
            <div class="node-chips">
              <button v-for="time in demoTimes" :key="time" class="chip chip-demo" :class="{ active: t === time }" @click="setT(time)">{{ time }}</button>
            </div>
          </div>
        </div>
        <div class="rail-head occ-head"><span class="no">02b</span><h2>资源占用</h2><span class="sub">active @{{ snapshot?.t_sim ?? 0 }}</span></div>
        <OccupancyBars
          :resources="fixture.scenario.resources"
          :occupancy="snapshot?.resource_occupancy ?? []"
          :active="snapshot?.active_resource_occupancy ?? []"
        />
        <p class="note">占用区间来自快照 resource_occupancy / active_resource_occupancy；容量校验由 A 的规则引擎负责，界面只展示。</p>
      </section>

      <section class="rail-sec sec-roads">
        <div class="rail-head"><span class="no">03</span><h2>道路双状态</h2><span class="sub">RoadStatus</span></div>
        <div class="table-wrap">
          <table class="data" id="roads-table">
            <thead>
              <tr><th>路段</th><th class="th-blue">自然灾情</th><th class="th-red">正式封闭</th></tr>
            </thead>
            <tbody>
              <tr
                v-for="rs in roads"
                :key="rs.road_id"
                :class="{ 'row-hl': highlight?.kind === 'road' && highlight.id === rs.road_id }"
                @mouseenter="hovered = { kind: 'road', id: rs.road_id }"
                @mouseleave="hovered = null"
                @click="toggleSelect('road', rs.road_id)"
              >
                <td class="wrap">
                  <button
                    class="road-pick"
                    :aria-pressed="selected?.kind === 'road' && selected.id === rs.road_id"
                    @focus="hovered = { kind: 'road', id: rs.road_id }"
                    @blur="hovered = null"
                    @click.stop="toggleSelect('road', rs.road_id)"
                  >
                    <span class="mono">{{ rs.road_id }}</span><br />{{ rs.name }}
                  </button>
                </td>
                <td class="cell-blue">
                  <template v-if="rs.hazard !== null">{{ HAZARD_LABEL[rs.hazard] }} @{{ rs.hazard_at_sim }}</template>
                  <template v-else>—</template>
                </td>
                <td class="cell-red">
                  <template v-if="rs.formally_closed">已封闭 @{{ rs.closed_at_sim }} · seq{{ rs.closed_by_action_seq }}</template>
                  <template v-else>未封闭</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="note">状态来自 replayTo(...).roads，非 road.blocked；随时间轴实时变化，两者可叠加。点行或路段名选中，详情见「对象详情」。</p>
      </section>

      <section class="rail-sec sec-route">
        <div class="rail-head"><span class="no">04</span><h2>路径查询</h2><span class="sub">getRoute</span></div>
        <div class="controls route-controls">
          <label class="control">
            <span class="control-label">起点</span>
            <select v-model="routeFrom" id="route-from" aria-label="路径起点">
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
          <label class="control">
            <span class="control-label">终点</span>
            <select v-model="routeTo" id="route-to" aria-label="路径终点">
              <option value="">未选择</option>
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
        </div>
        <div v-if="degenerate" class="alert-error" id="route-degenerate">起点与终点相同，已禁用查询；请另选终点。</div>
        <RoutePanel :route="route" :query="routeQuery" :map="map" :roads="roads" />
        <p class="note">端点候选 = 楼栋 + 路口（路口标注非楼栋）；上报定位候选另为楼栋 + 「无法定位」，不含路段与路口（JW-09）。长度口径为图上 px，非实际距离或耗时。</p>
      </section>

      <section class="rail-sec sec-legend">
        <div class="rail-head"><span class="no">05</span><h2>图例</h2><span class="sub">legend</span></div>
        <MapLegend />
        <div class="bld-index">
          <div class="bld-index-head">
            <span class="bld-title">楼栋清单</span>
            <span class="bld-count mono">{{ map.buildings.length }} 栋</span>
          </div>
          <ul class="bld-list">
            <li v-for="b in map.buildings" :key="b.id">
              <button
                class="bld-row"
                :class="{
                  on: highlight?.kind === 'building' && highlight.id === b.id,
                  pinned: selected?.kind === 'building' && selected.id === b.id,
                }"
                :aria-pressed="selected?.kind === 'building' && selected.id === b.id"
                @mouseenter="hovered = { kind: 'building', id: b.id }"
                @mouseleave="hovered = null"
                @focus="hovered = { kind: 'building', id: b.id }"
                @blur="hovered = null"
                @click="toggleSelect('building', b.id)"
              >
                <span
                  class="swatch"
                  :style="{ background: CATEGORY_STYLE[b.category].fill, borderColor: CATEGORY_STYLE[b.category].color }"
                ></span>
                <span class="bld-main">
                  <span class="bld-name">{{ b.name }}</span>
                  <span class="bld-sub">
                    {{ CATEGORY_STYLE[b.category].label }} · {{ b.zone
                    }}<template v-if="b.risk_tag !== null"> · <span class="risk">▲ {{ b.risk_tag }}</span></template>
                  </span>
                </span>
                <span class="bld-meta mono">{{ b.floors === null ? '通高' : `${b.floors} 层` }} · ≈{{ b.capacity }}</span>
              </button>
            </li>
          </ul>
          <p class="note">点按可在图上选中该楼栋；窄屏图上文字偏小，层数与容量以本清单为可读口径。</p>
        </div>
      </section>

      <section class="rail-sec sec-score">
        <div class="rail-head"><span class="no">06</span><h2>评分</h2><span class="sub">{{ currentRun?.branch }}</span></div>
        <ScorePanel :score="score" />
        <p class="note">评分恒传当前流水第二参数：完整匹配原始示例显示分数；偏离后 null 显示待接入常量，绝不回退基线。</p>
      </section>
    </aside>
  </section>
</template>