import { computed, getCurrentInstance, onUnmounted, ref, watch } from 'vue';
import type {
  ActionAttempt,
  ActionId,
  CanonicalFixture,
  LocationChoice,
  RunEvent,
  UgcReport,
  Verdict,
  VerdictAttempt,
} from '../contracts';
import type { FixturePort } from '../fixture-port';
import { deriveRounds, ENGINE_PENDING_LABEL, type RoundInfo } from '../config/rounds';

/**
 * A 规则引擎消费签名（提案，待协商）：B 传提交上下文，A 返回完整 ActionAttempt
 * （status / reject_reason_code / reject_reason / attempt / completed_at_sim / resource_usage）。
 * 未接入时返回 null，B 记「待引擎接入」占位，绝不伪造 accepted/rejected。
 */
export interface ActionSubmissionInput {
  action_id: ActionId;
  target_id: string;
  submitted_at_sim: number;
}
export type ActionJudge = (input: ActionSubmissionInput) => ActionAttempt | null;

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
  | { kind: 'action-confirmed'; event: Extract<RunEvent, { kind: 'action' }> };

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
  fixture: CanonicalFixture,
  port: FixturePort,
  options?: { judgeAction?: ActionJudge },
) {
  const rounds = deriveRounds(fixture.scenario);
  const tEnd = fixture.scenario.t_end;
  const speeds = fixture.scenario.playback_speeds;

  const roundIndex = ref(0);
  const currentRound = computed<RoundInfo | null>(() => rounds[roundIndex.value] ?? null);
  const currentT = computed(() => currentRound.value?.node.t_sim ?? 0);
  const canPrev = computed(() => roundIndex.value > 0);
  const canNext = computed(() => roundIndex.value < rounds.length - 1);
  const sortOpen = computed(() => currentRound.value?.kind === 'final');

  const speed = ref(speeds[0] ?? 1);
  const playing = ref(false);

  const entries = ref<LedgerEntry[]>([]);
  const nextSeq = ref(1);
  const deliveredIds = ref<Set<string>>(new Set());
  const lastBatch = ref<UgcReport[]>([]);
  const realElapsedMs = ref(0);

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

  let playTimer: number | null = null;
  function stopPlayTimer(): void {
    if (playTimer !== null) {
      window.clearInterval(playTimer);
      playTimer = null;
    }
  }
  function startPlayTimer(): void {
    stopPlayTimer();
    playTimer = window.setInterval(() => {
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

  const startMark = performance.now();
  const realTimer = window.setInterval(() => {
    realElapsedMs.value = performance.now() - startMark;
  }, 500);
  if (getCurrentInstance()) {
    onUnmounted(() => {
      stopPlayTimer();
      window.clearInterval(realTimer);
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
    if (!deliveredIds.value.has(reportId)) return null;
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
    entries.value.push({ kind: 'verdict', event: { seq, t_sim: tSim, kind: 'verdict', payload } });
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

  /**
   * FR-4.7 / FR-4.3：submitted_at_sim = 当前节点；duration 读 ActionDef 固定常量。
   * 对象按 target_kind 校验（A5→路段，其余→楼栋；路口不可作对象）。
   * 合法性来自 A 引擎；未接入记 pending 占位，不伪造 accepted/rejected。
   */
  function submitAction(actionId: ActionId, targetId: string): LedgerEntry | null {
    const def = fixture.action_catalog.find((action) => action.id === actionId);
    if (!def) return null;
    const targetOk =
      def.target_kind === 'building'
        ? port.map.buildings.some((building) => building.id === targetId)
        : port.map.road_segments.some((road) => road.id === targetId);
    if (!targetOk) return null;

    const tSim = currentT.value;
    const seq = nextSeq.value;
    nextSeq.value += 1;
    const attempt = actionAttemptCount(actionId, targetId) + 1;

    const judged = options?.judgeAction?.({ action_id: actionId, target_id: targetId, submitted_at_sim: tSim }) ?? null;
    if (judged) {
      const payload: ActionAttempt = { ...judged, seq, attempt };
      const entry: LedgerEntry = {
        kind: 'action-confirmed',
        event: { seq, t_sim: tSim, kind: 'action', payload },
      };
      entries.value.push(entry);
      return entry;
    }

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
    entries.value.push(entry);
    return entry;
  }

  /** 供 getScore 第二参数：只含已成形的流水记录；pending 提交尚未判定，不是流水事件。 */
  const currentEvents = computed<RunEvent[]>(() =>
    entries.value.flatMap((entry) =>
      entry.kind === 'verdict' || entry.kind === 'action-confirmed' ? [entry.event] : [],
    ),
  );

  /** 展示集合随当前回合可见性回退（FR-4.1/VS-01）：回 scrub 到早期回合时，晚出现的线索重新隐藏。
   *  deliveredIds 仍单调累计，仅用于做差投放与判读守卫，不决定展示。 */
  const deliveredReports = computed<UgcReport[]>(() => port.visibleReportsAt(currentT.value));

  function resetDrill(): void {
    playing.value = false;
    stopPlayTimer();
    entries.value = [];
    nextSeq.value = 1;
    deliveredIds.value = new Set();
    speed.value = speeds[0] ?? 1;
    roundIndex.value = 0;
    const first = rounds[0];
    if (first) deliverAt(first.node.t_sim);
  }

  const firstRound = rounds[0];
  if (firstRound) deliverAt(firstRound.node.t_sim);

  return {
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
    deliveredIds,
    deliveredReports,
    lastBatch,
    realElapsedMs,
    currentEvents,
    goToRound,
    goToTime,
    nextRound,
    prevRound,
    togglePlay,
    submitVerdict,
    submitAction,
    latestVerdictSeq,
    resetDrill,
  };
}

export type DrillRound = ReturnType<typeof useDrillRound>;