import type { RoundScore } from '../score-engine';
import { seqLabel } from './format';

export const REVIEW_SUMMARY_BADGE = '预置摘要 · AI 点评待接入';

export interface SummaryNames {
  actionName: (actionId: string) => string;
  targetName: (targetId: string) => string;
  locationName: (locationId: string) => string;
}

/** 确定性模板：输入仅整轮评分结果，逐条引用 seq / 上报 id / 动作名，只回顾模拟记录，不含真实事件指挥建议。 */
export function buildReviewSummary(score: RoundScore, names: SummaryNames): string[] {
  const { details, judgments, location, sorting } = score;
  const lines: string[] = [
    `本轮总分 ${score.total} / 100：甄别 ${score.discrimination} · 响应 ${score.response} · 命中 ${score.coverage} · 合规 ${score.violation}（权重 30 / 20 / 35 / 15）。`,
  ];
  if (details.response_seconds !== null && details.first_real_report_id !== null && details.first_response_action_seq !== null) {
    lines.push(`首报 ${details.first_real_report_id} 的有效响应 ${details.response_seconds} 秒，来自${seqLabel(details.first_response_action_seq)}。`);
  } else {
    lines.push('本轮无已完成的首报响应。');
  }
  lines.push(`判读正确 ${details.correct_judgments} / ${details.total_reports}。`);
  for (const judgment of judgments) {
    if (judgment.correct) continue;
    if (judgment.attempt) {
      const expected = judgment.window ? `当时可判为「${judgment.window.expected}」` : '当时无可判窗口';
      lines.push(`${judgment.report_id} 判为「${judgment.attempt.verdict}」，${expected}（${seqLabel(judgment.attempt.seq)}）。`);
    } else {
      lines.push(`${judgment.report_id} 未判读。`);
    }
  }
  const wrongLocations = judgments.filter((judgment) => judgment.attempt && !judgment.location_correct);
  if (wrongLocations.length) {
    lines.push(`定位正确 ${location.correct} / ${location.total}；${wrongLocations.map((judgment) =>
      `${judgment.report_id} 参考位置 ${judgment.expected_location === null ? '未设定' : names.locationName(judgment.expected_location)}`).join('；')}。`);
  } else {
    lines.push(`定位正确 ${location.correct} / ${location.total}。`);
  }
  lines.push(`标准处置命中权重 ${details.coverage_hit_weights} / ${details.coverage_total_weights}。`);
  if (details.missed_items.length) {
    lines.push(`漏做：${details.missed_items.map((item) => `${names.actionName(item.action_id)} · ${names.targetName(item.target_id)}`).join('；')}（回合结束前未完成）。`);
  }
  if (details.violation_count > 0) {
    lines.push(`重复违规 ${details.violation_count} 次（${details.violation_event_seqs.map(seqLabel).join('、')}）：同一动作被拒后再次提交仍被拒。`);
  } else {
    lines.push('无重复违规。');
  }
  if (sorting) {
    if (sorting.actual.length === 0) {
      lines.push(`未做排序；参考排序 ${sorting.expected.join(' → ')}。`);
    } else if (sorting.correct) {
      lines.push(`排序 ${sorting.actual.join(' → ')}，与参考一致。`);
    } else {
      lines.push(`排序 ${sorting.actual.join(' → ')}，参考排序 ${sorting.expected.join(' → ')}。`);
    }
  }
  return lines;
}