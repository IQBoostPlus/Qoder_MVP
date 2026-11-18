<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ActionId, LocationChoice, Verdict, VerdictAttempt } from '../contracts';
import { useFixturePort, useFixtureData } from '../composables/useFixturePort';
import { useDrillRound, pendingActionText } from '../composables/useDrillRound';
import { CATEGORY_STYLE, HAZARD_LABEL, formatBuildingFloors } from '../config/categories';
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
import { buildRouteQuery, endpointOptions, endpointName, locationOptions, UNLOCATABLE } from '../config/route-query';
import { DRILL_SKELETON_BADGE } from '../config/rounds';
import CampusMap from '../components/CampusMap.vue';
import MapLegend from '../components/MapLegend.vue';
import RoutePanel from '../components/RoutePanel.vue';
import ScorePanel from '../components/ScorePanel.vue';
import ObjectDetail from '../components/ObjectDetail.vue';
import OccupancyBars from '../components/OccupancyBars.vue';

const port = useFixturePort();
const fixture = useFixtureData();
const map = port.map;

const drill = useDrillRound(fixture, port);
const {
  rounds,
  tEnd,
  speeds,
  roundIndex,
  currentRound,
  currentT,
  canPrev,
  canNext,
  sortOpen,
  speed,
  playing,
  entries,
  deliveredReports,
  lastBatch,
  realElapsedMs,
} = drill;

const runs = fixture.runs;
const skeletonRunId = ref(runs[0]?.run_id ?? '');
// 做法 2（A 引擎未就绪）：地图/图层/道路/占用以标准样例 replayTo 为骨架，显式标注；
// 学员操作进入本地账本，合法性待 A 引擎，绝不以骨架冒充临场引擎结果。
const skeleton = computed(() => port.replayTo(skeletonRunId.value, { t_sim: currentT.value }));
const roads = computed(() => skeleton.value?.roads ?? []);
const overlay = computed(() => deriveLayerMarks(skeleton.value));
// 评分恒带第二参数（本地账本）；偏离基线 → null → SCORE_PENDING_TEXT，不回退 expected_scores。
const score = computed(() => port.getScore(skeletonRunId.value, drill.currentEvents.value));

const dockTab = ref<'round' | 'reports' | 'roads' | 'route' | 'legend' | 'score'>('round');

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

const layers = ref<Record<LayerKey, boolean>>({ disaster: true, cordon: true, rescue: true });

const endpoints = endpointOptions(map);
const locations = locationOptions(map);
const routeFrom = ref(fixture.scenario.start_building_id);
const routeTo = ref('');
const degenerate = computed(() => routeTo.value !== '' && routeFrom.value === routeTo.value);
const routeQuery = computed(() =>
  routeTo.value === '' || degenerate.value
    ? null
    : buildRouteQuery(map, skeleton.value, routeFrom.value, routeTo.value, currentT.value),
);
const route = computed(() => (routeQuery.value ? port.getRoute(routeQuery.value) : null));
function setEndpoint(id: string, role: 'from' | 'to'): void {
  if (role === 'from') routeFrom.value = id;
  else routeTo.value = id;
  dockTab.value = 'route';
}
// 回合是离散节点：跳转落在 ≥ 目标时刻的首个回合，不在节点间插值。
function jumpTo(tSim: number): void {
  const index = rounds.findIndex((round) => round.node.t_sim >= tSim);
  if (index >= 0) drill.goToRound(index);
  dockTab.value = 'round';
}

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

const hazardCount = computed(() => roads.value.filter((r) => r.hazard !== null).length);
const closedCount = computed(() => roads.value.filter((r) => r.formally_closed).length);
const totalReports = fixture.ugc_reports.length;
const realSeconds = computed(() => (realElapsedMs.value / 1000).toFixed(1));

// ---- 判读临时控件（D3 只记录与 stamp；判断窗对照反馈 / 改判覆盖完整 UI 属 D4） ----
const VERDICTS: Verdict[] = ['真报', '误报', '待核'];
const drafts = ref<Record<string, { verdict: Verdict; location: string }>>({});
watch(
  deliveredReports,
  (reports) => {
    for (const report of reports) {
      if (!drafts.value[report.id]) drafts.value[report.id] = { verdict: '待核', location: '' };
    }
  },
  { immediate: true },
);
function draftFor(reportId: string): { verdict: Verdict; location: string } {
  return drafts.value[reportId] ?? { verdict: '待核', location: '' };
}
function locationName(id: string): string {
  return id === UNLOCATABLE ? UNLOCATABLE : endpointName(map, id);
}
function recordVerdict(reportId: string): void {
  const draft = drafts.value[reportId];
  if (!draft) return;
  const location: LocationChoice | null = draft.location === '' ? null : draft.location;
  drill.submitVerdict(reportId, draft.verdict, location);
}
function latestVerdictOf(reportId: string): VerdictAttempt | null {
  let latest: VerdictAttempt | null = null;
  for (const entry of entries.value) {
    if (entry.kind === 'verdict' && entry.event.payload.report_id === reportId) latest = entry.event.payload;
  }
  return latest;
}

function onAction(actionId: ActionId, targetId: string): void {
  drill.submitAction(actionId, targetId);
  dockTab.value = 'round';
}

// ---- 账本摘要 ----
interface LedgerRow {
  seq: number;
  kindLabel: string;
  detail: string;
  stamp: number;
  state: string;
  pending: boolean;
}
const ledgerRows = computed<LedgerRow[]>(() =>
  entries.value.map((entry) => {
    if (entry.kind === 'verdict') {
      const p = entry.event.payload;
      const where = p.location === null ? '未定位' : locationName(p.location);
      return {
        seq: p.seq,
        kindLabel: '判读',
        detail: `${p.report_id} → ${p.verdict} · ${where}`,
        stamp: p.judged_at_sim,
        state: p.supersedes_seq === null ? '已记录' : `改判 · 覆盖 seq${p.supersedes_seq}`,
        pending: false,
      };
    }
    if (entry.kind === 'action-pending') {
      const s = entry.submission;
      const def = fixture.action_catalog.find((a) => a.id === s.action_id);
      return {
        seq: s.seq,
        kindLabel: '动作',
        detail: `${s.action_id} ${def?.name ?? ''} → ${endpointName(map, s.target_id)} · 第${s.attempt}次`,
        stamp: s.submitted_at_sim,
        state: pendingActionText(s, currentT.value),
        pending: true,
      };
    }
    const p = entry.event.payload;
    return {
      seq: p.seq,
      kindLabel: '动作',
      detail: `${p.action_id} → ${endpointName(map, p.target_id)} · 第${p.attempt}次`,
      stamp: p.submitted_at_sim,
      state:
        p.status === 'accepted'
          ? `已通过 · 完成 @${p.completed_at_sim}`
          : `已拒绝 · ${p.reject_reason_code ?? ''} ${p.reject_reason ?? ''}`,
      pending: false,
    };
  }),
);

const sortNotice = ref(false);
function openSort(): void {
  if (sortOpen.value) sortNotice.value = true;
}
function resetDrill(): void {
  drill.resetDrill();
  sortNotice.value = false;
  drafts.value = {};
}
</script>

<template>
  <section class="mapwrap">
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
          <span class="hud-label">SIM CLOCK · ROUND</span>
          <span class="hud-clock" id="drill-t">T+{{ currentT }}<small>s</small></span>
          <span class="hud-line" id="drill-round-indicator">第 {{ roundIndex + 1 }}/{{ rounds.length }} 回合 · {{ currentRound?.kindLabel }}</span>
          <span class="hud-line dim">{{ speed }}× · {{ playing ? '自动推进中' : '已暂停' }} · 倍速仅记录值</span>
        </div>

        <div class="hud hud-tr">
          <span class="hud-label">NETWORK</span>
          <span class="hud-line">{{ map.buildings.length }} 栋 · {{ map.road_segments.length }} 路段 · {{ map.junctions.length }} 路口</span>
          <span class="hud-line dim">骨架 {{ skeletonRunId }} · 非临场引擎结果</span>
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

    <aside class="rail" :data-active="dockTab">
      <div class="seg" role="tablist" aria-label="推演舱切换">
        <button :class="{ on: dockTab === 'round' }" @click="dockTab = 'round'">回合</button>
        <button :class="{ on: dockTab === 'reports' }" @click="dockTab = 'reports'">上报</button>
        <button :class="{ on: dockTab === 'roads' }" @click="dockTab = 'roads'">道路</button>
        <button :class="{ on: dockTab === 'route' }" @click="dockTab = 'route'">路径</button>
        <button :class="{ on: dockTab === 'legend' }" @click="dockTab = 'legend'">图例</button>
        <button :class="{ on: dockTab === 'score' }" @click="dockTab = 'score'">评分</button>
      </div>

      <!-- 回合控制常驻 -->
      <section class="rail-sec sec-roundctl">
        <div class="rail-head"><span class="no">R0</span><h2>回合控制</h2><span class="sub">FR-4.7</span></div>
        <div class="round-now">
          <span class="round-now-t mono">T+{{ currentT }}s</span>
          <span class="round-now-label">{{ currentRound?.node.label }}</span>
        </div>
        <div class="round-progress" role="group" aria-label="节点进度">
          <button
            v-for="round in rounds"
            :key="round.node.id"
            class="round-tick"
            :class="{ current: round.index === roundIndex, advance: round.kind === 'advance', final: round.kind === 'final' }"
            :aria-current="round.index === roundIndex ? 'step' : undefined"
            :title="round.node.label"
            @click="drill.goToRound(round.index)"
          >
            <span class="tick-t mono">{{ round.node.t_sim }}</span>
            <span class="tick-kind">{{ round.kind === 'advance' ? '推进' : round.kind === 'final' ? '末回合' : '事件' }}</span>
          </button>
        </div>
        <div class="controls round-controls">
          <button class="btn" id="round-prev" :disabled="!canPrev" @click="drill.prevRound()">上一回合</button>
          <button class="btn" id="round-next" :disabled="!canNext" @click="drill.nextRound()">下一回合</button>
          <button class="btn" id="round-play" :disabled="!canNext" :aria-pressed="playing" @click="drill.togglePlay()">
            {{ playing ? '暂停' : '自动播放' }}
          </button>
          <label class="control">
            <span class="control-label">控速</span>
            <select v-model.number="speed" id="speed-select" aria-label="播放速度">
              <option v-for="s in speeds" :key="s" :value="s">{{ s }}×</option>
            </select>
          </label>
          <button class="btn" id="drill-reset" @click="resetDrill">重置推演</button>
        </div>
        <p class="round-stats mono" id="round-stats">
          可见 {{ deliveredReports.length }}/{{ totalReports }} · 本回合新增 {{ lastBatch.length }} · 真实用时 {{ realSeconds }}s（不计分）
        </p>
        <div class="drill-notice">
          <span class="badge badge-blue badge-sm">{{ DRILL_SKELETON_BADGE }}</span>
          <label class="control">
            <span class="control-label">骨架流水</span>
            <select v-model="skeletonRunId" id="skeleton-select" aria-label="骨架样例流水">
              <option v-for="r in runs" :key="r.run_id" :value="r.run_id">{{ r.branch }} · {{ r.run_id }}</option>
            </select>
          </label>
        </div>
        <p class="note">地图 / 图层 / 道路 / 占用来自标准样例骨架 replayTo，随回合刷新；学员操作进入本地账本，动作合法性待 A 规则引擎接入。这不是临场引擎结果。</p>
      </section>

      <section class="rail-sec sec-detail">
        <div class="rail-head"><span class="no">R1</span><h2>对象详情 · 临时提交</h2><span class="sub">select</span></div>
        <ObjectDetail
          :selection="selected"
          :map="map"
          :roads="roads"
          :overlay="overlay"
          :actions="fixture.action_catalog"
          @jump="jumpTo"
          @endpoint="setEndpoint"
          @action="onAction"
        />
        <p class="note">时刻跳转落在 ≥ 目标时刻的首个回合（回合是离散节点，不插值）。</p>
      </section>

      <section class="rail-sec sec-situation">
        <div class="rail-head"><span class="no">R2</span><h2>当前态势</h2><span class="sub">skeleton</span></div>
        <ul v-if="situation.length" class="situation-list">
          <li v-for="entry in situation" :key="entry.key">
            <span class="sit-dot" :style="{ background: entry.color }" aria-hidden="true"></span>
            <span>{{ entry.text }}</span>
          </li>
        </ul>
        <p v-else class="note">当前回合骨架无灾情 / 警戒 / 救援队 / 封闭标记；随回合推进出现。</p>
      </section>

      <section class="rail-sec sec-round">
        <div class="rail-head"><span class="no">R3</span><h2>回合账本</h2><span class="sub">local ledger</span></div>
        <p class="note">回合内一切操作时刻 = 当前节点 t_sim（FR-4.7 / TC-06）；真实用时单独累计，不参与 stamp、不计分（FR-4.6）。</p>
        <div v-if="ledgerRows.length" class="table-wrap">
          <table class="data" id="ledger-table">
            <thead>
              <tr><th>seq</th><th>类型</th><th>对象</th><th class="th-amber">时刻</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in ledgerRows" :key="row.seq">
                <td class="num">{{ row.seq }}</td>
                <td>{{ row.kindLabel }}</td>
                <td class="wrap">{{ row.detail }}</td>
                <td class="num cell-amber">{{ row.stamp }}</td>
                <td :class="row.pending ? 'cell-amber' : ''">{{ row.state }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="note">本会话暂无操作。在图上选楼栋 / 路段提交动作，或到「上报」页签判读；推进回合（无新事件）同样可行动（TC-07）。</p>

        <div class="sort-gate">
          <button class="btn" id="sort-entry" :disabled="!sortOpen" @click="openSort">整批优先级排序（仅末回合）</button>
          <p v-if="!sortOpen" class="note">末回合 t_end={{ tEnd }} 才开放（VS-03）；届时全部 {{ totalReports }} 条上报可见（VS-04）。</p>
          <p v-else-if="sortNotice" class="note" id="sort-placeholder">入口已开放：选 3 条排序的完整交互属 D4，D3 只做门控占位，未实现排序提交。</p>
          <p v-else class="note">末回合：排序入口开放，点击显示 D4 占位说明。</p>
        </div>

        <div class="rail-head occ-head"><span class="no">R3b</span><h2>资源占用</h2><span class="sub">骨架 active @{{ currentT }}</span></div>
        <OccupancyBars
          :resources="fixture.scenario.resources"
          :occupancy="skeleton?.resource_occupancy ?? []"
          :active="skeleton?.active_resource_occupancy ?? []"
        />
        <p class="note">占用区间来自骨架快照；学员动作的占用与容量校验待 A 引擎判定后进入账本，界面只展示。</p>
      </section>

      <section class="rail-sec sec-reports">
        <div class="rail-head"><span class="no">R4</span><h2>模拟上报</h2><span class="sub">分批投放</span></div>
        <p v-if="lastBatch.length > 0" class="batch-banner" id="batch-banner">本回合新增 {{ lastBatch.length }} 条</p>
        <p class="note">进入回合投放 appears_at_sim ≤ 当前节点且尚未投放的上报；未到线索不可见（FR-4.1 / VS-01）。不要求判完整批即可行动（VS-02）。</p>
        <ul class="report-list">
          <li v-for="report in deliveredReports" :key="report.id" class="report-card">
            <div class="report-head">
              <span class="report-id mono">{{ report.id }}</span>
              <span class="report-at mono">@{{ report.appears_at_sim }}</span>
              <span class="badge badge-red badge-sm">训练模拟数据</span>
            </div>
            <p class="report-text">{{ report.text }}</p>
            <p v-if="latestVerdictOf(report.id)" class="report-verdict">
              已记录：{{ latestVerdictOf(report.id)?.verdict }} ·
              {{ latestVerdictOf(report.id)?.location === null ? '未定位' : locationName(latestVerdictOf(report.id)?.location ?? '') }}
              @{{ latestVerdictOf(report.id)?.judged_at_sim }}
              <template v-if="latestVerdictOf(report.id)?.supersedes_seq !== null"> · 改判覆盖 seq{{ latestVerdictOf(report.id)?.supersedes_seq }}</template>
            </p>
            <div class="verdict-controls">
              <label class="control">
                <span class="control-label">判读</span>
                <select v-model="draftFor(report.id).verdict" :aria-label="`判读 ${report.id}`">
                  <option v-for="v in VERDICTS" :key="v" :value="v">{{ v }}</option>
                </select>
              </label>
              <label class="control">
                <span class="control-label">定位</span>
                <select v-model="draftFor(report.id).location" :aria-label="`定位 ${report.id}`">
                  <option value="">未选择</option>
                  <option v-for="opt in locations" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
                </select>
              </label>
              <button class="btn" @click="recordVerdict(report.id)">记录判读</button>
            </div>
          </li>
        </ul>
        <p class="note">定位候选 = 楼栋 + 「无法定位」，不含路段 / 路口（JW-09）。判断窗对照反馈与改判覆盖完整 UI 属 D4；D3 只保证记录与 stamp 正确。</p>
      </section>

      <section class="rail-sec sec-roads">
        <div class="rail-head"><span class="no">R5</span><h2>道路双状态</h2><span class="sub">骨架 RoadStatus</span></div>
        <div class="table-wrap">
          <table class="data" id="drill-roads-table">
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
        <p class="note">骨架道路态随回合更新；选中路段后可在「对象详情」提交 A5 封路（合法性待 A 引擎）。</p>
      </section>

      <section class="rail-sec sec-route">
        <div class="rail-head"><span class="no">R6</span><h2>路径查询</h2><span class="sub">getRoute</span></div>
        <div class="controls route-controls">
          <label class="control">
            <span class="control-label">起点</span>
            <select v-model="routeFrom" id="drill-route-from" aria-label="路径起点">
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
          <label class="control">
            <span class="control-label">终点</span>
            <select v-model="routeTo" id="drill-route-to" aria-label="路径终点">
              <option value="">未选择</option>
              <option v-for="opt in endpoints" :key="opt.id" :value="opt.id">{{ opt.name }}（{{ opt.note }}）</option>
            </select>
          </label>
        </div>
        <div v-if="degenerate" class="alert-error" id="drill-route-degenerate">起点与终点相同，已禁用查询；请另选终点。</div>
        <RoutePanel :route="route" :query="routeQuery" :map="map" :roads="roads" />
        <p class="note">路径随标准样例的道路状态更新，长度为图上 px。</p>
      </section>

      <section class="rail-sec sec-legend">
        <div class="rail-head"><span class="no">R7</span><h2>图例</h2><span class="sub">legend</span></div>
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
                <span class="bld-meta mono">{{ formatBuildingFloors(b) }} · ≈{{ b.capacity }}</span>
              </button>
            </li>
          </ul>
          <p class="note">点按可在图上选中该楼栋并提交动作；层数与容量以本清单为可读口径。</p>
        </div>
      </section>

      <section class="rail-sec sec-score">
        <div class="rail-head"><span class="no">R8</span><h2>评分</h2><span class="sub">待 D4</span></div>
        <ScorePanel :score="score" />
        <p class="note">评分恒传本地账本第二参数：偏离基线 → null → 待接入常量，绝不回退基线分。实时评分里程碑属 D4；违规明细只读 ScoreResult.details.violation_event_seqs，呈现属 D4。</p>
      </section>
    </aside>
  </section>
</template>
