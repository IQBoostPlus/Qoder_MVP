import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type {
  ActionId,
  LocationChoice,
  ReportId,
  RunEvent,
  SortSubmission,
  UgcReport,
  Verdict,
  VerdictAttempt,
} from '../contracts';
import type { RunProgress } from '../run-store/contracts';
import type { ActionJudge } from '../action-engine';
import type { RoundData } from '../scenario-generation/contracts';
import type { FixturePort } from '../fixture-port';
import { SORT_LIMIT } from '../score-engine';
import { deriveRounds, ENGINE_PENDING_LABEL, type RoundInfo } from '../config/rounds';

export interface PendingActionSubmission {
  seq: number;
  attempt: number;
  action_id: ActionId;
  target_id: string;
  submitted_at_sim: number;
  duration_sim: number;
  /** 提交时刻 + ActionDef.duration_sim 的算术期望；合法性未判定，不代表已完成 */
  expected_completed_at_sim: number;
}

export type LedgerEntry =
  | { kind: 'verdict'; event: Extract<RunEvent, { kind: 'verdict' }> }
  | { kind: 'action-pending'; submission: PendingActionSubmission }
  | { kind: 'action-confirmed'; event: Extract<RunEvent, { kind: 'action' }> }
  | { kind: 'sort'; event: Extract<RunEvent, { kind: 'sort' }> };

/** 自动推进的真实等待基准（毫秒）。只压缩真实等待，与 t_sim / duration_sim 无关。 */
export const ROUND_BASE_WAIT_MS = 4000;

export function pendingActionText(submission: PendingActionSubmission, tSim: number): string {
  const phase =
    tSim >= submission.expected_completed_at_sim
      ? `预计完成时刻已到 @${submission.expected_completed_at_sim}`
      : `预计完成 @${submission.expected_completed_at_sim}`;
  return `${ENGINE_PENDING_LABEL} · ${phase}`;
}

export function useDrillRound(
  fixture: RoundData,
  port: FixturePort,
  options?: { judgeAction?: ActionJudge; restored?: { progress: RunProgress; events: RunEvent[] }; clockPaused?: boolean },
) {
  const rounds = deriveRounds(fixture.scenario);
  const tEnd = fixture.scenario.t_end;
  const speeds = fixture.scenario.playback_speeds;

  const restored = options?.restored;
  const roundIndex = ref(restored?.progress.node ?? 0);
  const furthestRoundIndex = ref(restored?.progress.furthest ?? 0);
  const currentRound = computed<RoundInfo | null>(() => rounds[roundIndex.value] ?? null);
  const currentT = computed(() => currentRound.value?.node.t_sim ?? 0);
  const canPrev = computed(() => roundIndex.value > 0);
  const canNext = computed(() => roundIndex.value < rounds.length - 1);
  const finished = ref(restored?.progress.finished ?? false);
  const canWrite = computed(() => !finished.value && roundIndex.value === furthestRoundIndex.value);
  const sortOpen = computed(() => canWrite.value && currentRound.value?.kind === 'final');

  const speed = ref(restored?.progress.speed ?? speeds[0] ?? 1);
  const playing = ref(false);

  const entries = shallowRef<readonly LedgerEntry[]>(restored?.events.map((event) => {
    if (event.kind === 'action') return { kind: 'action-confirmed', event };
    if (event.kind === 'sort') return { kind: 'sort', event };
    return { kind: 'verdict', event };
  }) ?? []);
  const nextSeq = ref((restored?.events.at(-1)?.seq ?? 0) + 1);
  const deliveredIds = ref(new Set(restored ? port.visibleReportsAt(rounds[furthestRoundIndex.value]!.node.t_sim).map(({ id }) => id) : []));
  const lastBatch = ref<UgcReport[]>([]);
  const realElapsedMs = ref(restored?.progress.elapsed_ms ?? 0);

  function deliverAt(tSim: number): void {
    const visible = port.visibleReportsAt(tSim);
    const fresh = visible.filter((report) => !deliveredIds.value.has(report.id));
    if (fresh.length > 0) {
      const merged = new Set(deliveredIds.value);
      for (const report of fresh) merged.add(report.id);
      deliveredIds.value = merged;
    }
    lastBatch.value = fresh;
  }

  function goToRound(index: number): void {
    const clamped = Math.min(Math.max(index, 0), rounds.length - 1);
    roundIndex.value = clamped;
    furthestRoundIndex.value = Math.max(furthestRoundIndex.value, clamped);
    const round = rounds[clamped];
    if (round) deliverAt(round.node.t_sim);
    if (clamped >= rounds.length - 1) {
      playing.value = false;
      stopPlayTimer();
    }
  }
  function nextRound(): void {
    if (canNext.value) goToRound(roundIndex.value + 1);
  }
  function prevRound(): void {
    if (canPrev.value) goToRound(roundIndex.value - 1);
  }
  function goToTime(tSim: number): void {
    const index = rounds.findIndex((round) => round.node.t_sim === tSim);
    if (index >= 0) goToRound(index);
  }

  let playTimer: ReturnType<typeof setInterval> | null = null;
  function stopPlayTimer(): void {
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }
  function startPlayTimer(): void {
    stopPlayTimer();
    playTimer = setInterval(() => {
      if (roundIndex.value >= rounds.length - 1) {
        playing.value = false;
        stopPlayTimer();
        return;
      }
      goToRound(roundIndex.value + 1);
    }, ROUND_BASE_WAIT_MS / speed.value);
  }
  function togglePlay(): void {
    if (!canNext.value) return;
    playing.value = !playing.value;
    if (playing.value) startPlayTimer();
    else stopPlayTimer();
  }
  watch(speed, () => {
    if (playing.value) startPlayTimer();
  });

  let startMark: number | null = options?.clockPaused || finished.value ? null : performance.now() - realElapsedMs.value;
  function readClock(): number {
    return startMark === null ? realElapsedMs.value : Math.round(performance.now() - startMark);
  }
  function pauseClock(): void {
    realElapsedMs.value = readClock();
    startMark = null;
    playing.value = false;
    stopPlayTimer();
  }
  function resumeClock(): void {
    if (startMark === null && !finished.value) startMark = performance.now() - realElapsedMs.value;
  }
  const realTimer = setInterval(() => { realElapsedMs.value = readClock(); }, 500);
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopPlayTimer();
      clearInterval(realTimer);
    });
  }

  function latestVerdictSeq(reportId: string): number | null {
    let seq: number | null = null;
    for (const entry of entries.value) {
      if (entry.kind === 'verdict' && entry.event.payload.report_id === reportId) {
        seq = entry.event.payload.seq;
      }
    }
    return seq;
  }

  /** FR-4.7：judged_at_sim 一律当前节点 t_sim；改判写 supersedes_seq。只接受已投放上报。 */
  function submitVerdict(
    reportId: string,
    verdict: Verdict,
    location: LocationChoice | null,
  ): VerdictAttempt | null {
    if (!canWrite.value || !deliveredReports.value.some((report) => report.id === reportId)) return null;
    const tSim = currentT.value;
    const seq = nextSeq.value;
    nextSeq.value += 1;
    const payload: VerdictAttempt = {
      seq,
      report_id: reportId,
      judged_at_sim: tSim,
      verdict,
      location,
      supersedes_seq: latestVerdictSeq(reportId),
    };
    entries.value = [...entries.value, { kind: 'verdict', event: { seq, t_sim: tSim, kind: 'verdict', payload } }];
    return payload;
  }

  function actionAttemptCount(actionId: ActionId, targetId: string): number {
    let count = 0;
    for (const entry of entries.value) {
      if (entry.kind === 'action-pending') {
        if (entry.submission.action_id === actionId && entry.submission.target_id === targetId) count += 1;
      } else if (entry.kind === 'action-confirmed') {
        if (entry.event.payload.action_id === actionId && entry.event.payload.target_id === targetId) count += 1;
      }
    }
    return count;
  }

  function submitAction(actionId: ActionId, targetId: string): LedgerEntry | null {
    if (!canWrite.value) return null;
    const tSim = currentT.value;
    const seq = nextSeq.value;
    const judged = options?.judgeAction?.({
      action_id: actionId,
      target_id: targetId,
      submitted_at_sim: tSim,
      seq,
      prior_events: currentEvents.value,
    });
    if (judged) {
      const entry: LedgerEntry = {
        kind: 'action-confirmed',
        event: { seq, t_sim: tSim, kind: 'action', payload: judged },
      };
      entries.value = [...entries.value, entry];
      nextSeq.value += 1;
      return entry;
    }

    // 未接判定的诊断探针仍可记录 pending，并限制为可选对象。
    const def = fixture.action_catalog.find((action) => action.id === actionId);
    if (!def) return null;
    const targetOk =
      def.target_kind === 'building'
        ? port.map.buildings.some((building) => building.id === targetId)
        : port.map.road_segments.some((road) => road.id === targetId);
    if (!targetOk) return null;

    nextSeq.value += 1;
    const attempt = actionAttemptCount(actionId, targetId) + 1;

    const submission: PendingActionSubmission = {
      seq,
      attempt,
      action_id: actionId,
      target_id: targetId,
      submitted_at_sim: tSim,
      duration_sim: def.duration_sim,
      expected_completed_at_sim: tSim + def.duration_sim,
    };
    const entry: LedgerEntry = { kind: 'action-pending', submission };
    entries.value = [...entries.value, entry];
    return entry;
  }

  function submitSort(orderedIds: readonly ReportId[]): SortSubmission | null {
    if (!sortOpen.value || entries.value.some((entry) => entry.kind === 'sort')) return null;
    const visibleIds = new Set(deliveredReports.value.map(({ id }) => id));
    if (orderedIds.length !== Math.min(SORT_LIMIT, visibleIds.size) || orderedIds.length === 0 ||
        new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => visibleIds.has(id))) return null;
    const seq = nextSeq.value++;
    const payload = { seq, t_sim: currentT.value, ordered_report_ids: [...orderedIds] };
    entries.value = [...entries.value, { kind: 'sort', event: { seq, t_sim: currentT.value, kind: 'sort', payload } }];
    return payload;
  }

  function finishDrill(): boolean {
    if (!sortOpen.value) return false;
    playing.value = false;
    stopPlayTimer();
    pauseClock();
    finished.value = true;
    return true;
  }

  /** 已确认事件供评分与复盘使用，诊断探针的 pending 提交除外。 */
  const currentEvents = computed<RunEvent[]>(() =>
    entries.value.flatMap((entry) =>
      entry.kind === 'action-pending' ? [] : [entry.event],
    ),
  );

  /** 展示及判读守卫以当前回合可见性为准；deliveredIds 只用于计算新增批次。 */
  const deliveredReports = computed<UgcReport[]>(() => port.visibleReportsAt(currentT.value));

  function resetDrill(): void {
    finished.value = false;
    playing.value = false;
    stopPlayTimer();
    entries.value = [];
    nextSeq.value = 1;
    deliveredIds.value = new Set();
    speed.value = speeds[0] ?? 1;
    roundIndex.value = 0;
    furthestRoundIndex.value = 0;
    startMark = options?.clockPaused ? null : performance.now();
    realElapsedMs.value = 0;
    const first = rounds[0];
    if (first) deliverAt(first.node.t_sim);
  }

  const firstRound = rounds[roundIndex.value];
  if (firstRound) deliverAt(firstRound.node.t_sim);

  return {
    rounds,
    tEnd,
    speeds,
    roundIndex,
    currentRound,
    currentT,
    furthestRoundIndex,
    canWrite,
    finished,
    canPrev,
    canNext,
    sortOpen,
    speed,
    playing,
    entries,
    deliveredIds,
    deliveredReports,
    lastBatch,
    realElapsedMs,
    readClock,
    pauseClock,
    resumeClock,
    currentEvents,
    goToRound,
    goToTime,
    nextRound,
    prevRound,
    togglePlay,
    submitVerdict,
    submitAction,
    submitSort,
    finishDrill,
    latestVerdictSeq,
    resetDrill,
  };
}

export type DrillRound = ReturnType<typeof useDrillRound>;
