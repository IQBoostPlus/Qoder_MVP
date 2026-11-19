import type {
  ActionDef, CanonicalFixture, JudgmentWindow, LocationChoice, ReportId, RunEvent,
  ScoreResult, StandardActionItem, UgcReport, VerdictAttempt,
} from './contracts';
import { actionCompletedBy, windowAt } from './fixture-port';

export const SORT_LIMIT = 3;

export interface ReportAssessment {
  report_id: ReportId;
  attempt: VerdictAttempt | null;
  window: JudgmentWindow | null;
  correct: boolean;
  expected_location: LocationChoice | null;
  location_correct: boolean;
}

export interface RoundScore extends ScoreResult {
  judgments: ReportAssessment[];
  location: { correct: number; total: number; percent: number };
}

const percentage = (count: number, total: number): number => total === 0 ? 0 : 100 * count / total;
const actionKey = (item: Pick<StandardActionItem, 'action_id' | 'target_id'>): string => JSON.stringify([item.action_id, item.target_id]);

function assessReport(
  source: Pick<CanonicalFixture, 'ugc_reports'>,
  report: UgcReport,
  attempt: VerdictAttempt | null,
): ReportAssessment {
  const window = attempt ? windowAt(source, report.id, attempt.judged_at_sim) : null;
  const expectedLocation = report.event_truth.locatable ? report.event_truth.building_id : '无法定位';
  return {
    report_id: report.id,
    attempt,
    window,
    correct: window !== null && window.expected === attempt?.verdict,
    expected_location: expectedLocation,
    location_correct: expectedLocation !== null && attempt?.location === expectedLocation,
  };
}

/** Recalculate a finished round from its confirmed events and scenario, without fixture scores. */
export function scoreRound(
  source: Pick<CanonicalFixture, 'scenario' | 'ugc_reports' | 'action_catalog'>,
  events: readonly RunEvent[],
): RoundScore {
  const { t_end: end, standard_actions: standards } = source.scenario;
  const ordered = events.filter((event) => event.t_sim <= end).sort((a, b) => a.seq - b.seq);
  const reports = source.ugc_reports.filter((report) => report.appears_at_sim <= end);
  const verdicts = new Map<ReportId, VerdictAttempt>();
  const rejected = new Set<string>();
  const violations: number[] = [];
  const hits = new Set<string>();
  const firstReal = reports.reduce<UgcReport | null>((first, report) =>
    report.event_truth.is_real && (first === null || report.appears_at_sim < first.appears_at_sim)
      ? report : first, null);
  let firstResponse: { seq: number; completedAt: number } | null = null;
  let actualSort: ReportId[] = [];

  for (const event of ordered) {
    if (event.kind === 'verdict') {
      verdicts.set(event.payload.report_id, event.payload);
      continue;
    }
    if (event.kind === 'sort') {
      if (event.t_sim === end) actualSort = [...event.payload.ordered_report_ids];
      continue;
    }
    const action = event.payload;
    const key = actionKey(action);
    if (action.status === 'rejected') {
      if (rejected.has(key)) violations.push(action.seq);
      rejected.add(key);
    }
    if (!actionCompletedBy(action, end)) continue;
    hits.add(key);
    if (firstReal && action.target_id === firstReal.event_truth.building_id &&
        action.completed_at_sim >= firstReal.appears_at_sim &&
        (firstResponse === null || action.completed_at_sim < firstResponse.completedAt)) {
      firstResponse = { seq: action.seq, completedAt: action.completed_at_sim };
    }
  }

  const judgments = reports.map((report) => assessReport(source, report, verdicts.get(report.id) ?? null));
  const wrong = judgments.filter((judgment) => !judgment.correct).map((judgment) => judgment.report_id);
  const correct = judgments.length - wrong.length;
  const locationCorrect = judgments.filter((judgment) => judgment.location_correct).length;
  const responseSeconds = firstReal && firstResponse ? firstResponse.completedAt - firstReal.appears_at_sim : null;
  const actionWeights = new Map<ActionDef['id'], number>(source.action_catalog.map(({ id, weight }) => [id, weight]));
  const missed = standards.filter((item) => !hits.has(actionKey(item)));
  const sumWeights = (items: readonly StandardActionItem[]): number =>
    items.reduce((sum, item) => sum + (actionWeights.get(item.action_id) ?? 0), 0);
  const standardWeight = sumWeights(standards);
  const hitWeight = standardWeight - sumWeights(missed);
  const expectedSort = [...reports].sort((a, b) => a.priority - b.priority).slice(0, SORT_LIMIT).map(({ id }) => id);

  const discrimination = percentage(correct, judgments.length);
  const response = responseSeconds === null ? 0 : Math.max(0, Math.min(100, percentage(240 - responseSeconds, 180)));
  const coverage = percentage(hitWeight, standardWeight);
  const violation = Math.max(0, 100 - 15 * violations.length);
  return {
    discrimination, response, coverage, violation,
    total: Math.round(discrimination * 0.3 + response * 0.2 + coverage * 0.35 + violation * 0.15),
    details: {
      correct_judgments: correct,
      total_reports: judgments.length,
      wrong_report_ids: wrong,
      first_real_report_id: firstReal?.id ?? null,
      first_response_action_seq: firstResponse?.seq ?? null,
      response_seconds: responseSeconds,
      coverage_hit_weights: hitWeight,
      coverage_total_weights: standardWeight,
      missed_items: missed.map((item) => ({ ...item })),
      violation_count: violations.length,
      violation_event_seqs: violations,
    },
    sorting: {
      actual: actualSort,
      expected: expectedSort,
      correct: actualSort.length === expectedSort.length && actualSort.every((id, index) => id === expectedSort[index]),
    },
    judgments,
    location: { correct: locationCorrect, total: judgments.length, percent: percentage(locationCorrect, judgments.length) },
  };
}
