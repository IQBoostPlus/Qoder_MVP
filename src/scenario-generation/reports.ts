import type { UgcReport } from '../contracts';
import { record, ValidationError } from './bundle.ts';

// The model can select a natural opening, but the trusted report sentence is
// always present verbatim. This preserves entity, negation and duplicate facts.
const openings: Record<UgcReport['category'], readonly string[]> = {
  true_report: ['现场补充：', '值班记录：', '收到一条消息：'],
  false_report: ['核对消息：', '补记一条：', '转来一条说明：'],
  emotional: ['我想补充：', '有点着急：', '再发一条：'],
  vague_location: ['我听到的消息：', '先转一条：', '我也说不准：'],
  duplicate: ['再转一次：', '补转原消息：', '同一条消息再发一下：'],
  other: ['补记：'],
};
const keys = ['id', 'category', 'appears_at_sim', 'priority', 'event_truth', 'judgment_windows'] as const;

function fail(path: string, code: string, message: string): never {
  throw new ValidationError({ path, code, message });
}
function same(a: unknown, b: unknown): boolean {
  if (record(b)) return record(a) && Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([key, value]) => same(a[key], value));
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((item, i) => same(a[i], item));
  return a === b;
}

function copyLabels(report: UgcReport) {
  const { id, category, appears_at_sim, priority, event_truth, judgment_windows } = report;
  return { id, category, appears_at_sim, priority, event_truth, judgment_windows };
}

function choices(report: UgcReport): string[] {
  return [report.text, ...openings[report.category].map((opening) => opening + report.text)];
}

export function reportCandidates(preset: readonly UgcReport[]): Array<ReturnType<typeof copyLabels> & { text: string[] }> {
  return preset.map((report) => ({ ...copyLabels(report), text: choices(report) }));
}

export function reportsPrompt(preset: readonly UgcReport[], issue?: { code: string; path: string }): string {
  return JSON.stringify({
    task: 'd6_reports', instruction: '一次返回完整 JSON 数组，恰好 10 个对象。保留每个槽位的全部标签，并把 text 从候选数组中选为单个字符串；优先选不同于预置首项的自然表述。不要添加未给出的事实、地点、答案或解释。',
    slots: reportCandidates(preset), previous_validation_issue: issue ? { code: issue.code, path: issue.path } : undefined,
  });
}

export function validateReportBatch(input: unknown, preset: readonly UgcReport[]): UgcReport[] {
  if (!Array.isArray(input) || input.length !== 10) fail('reports', 'REPORT_COUNT', '必须一次提交 10 条上报');
  const slots = new Map(preset.map((report) => [report.id, report]));
  const unique = new Map<string, UgcReport>();
  for (const [index, value] of input.entries()) {
    const path = 'reports.' + index;
    if (!record(value) || Object.keys(value).some((key) => ![...keys, 'text', 'is_training'].includes(key as typeof keys[number])) ||
        value.is_training !== undefined && value.is_training !== 1) fail(path, 'REPORT_STRUCTURE', '上报字段无效');
    const slot = typeof value.id === 'string' ? slots.get(value.id) : undefined;
    if (!slot || unique.has(slot.id)) fail(path + '.id', 'REPORT_ID', '未知或重复的上报槽位');
    for (const key of keys) {
      if (!same(value[key], slot[key])) fail(path + '.' + key, 'REPORT_LABEL_CONFLICT', '上报标签与可信槽位不一致');
    }
    const text = value.text;
    if (typeof text !== 'string' || !choices(slot).includes(text)) fail(path + '.text', 'REPORT_FACT_CONFLICT', '文案与槽位事实或表达范围不符');
    unique.set(slot.id, { ...slot, text });
  }
  const reports = preset.map((report) => unique.get(report.id)!);
  if (reports.every((report, index) => report.text === preset[index]?.text)) {
    fail('reports', 'REPORTS_UNCHANGED', '整批文案与预置完全相同');
  }
  return reports;
}

export function parseReportBatch(raw: string, preset: readonly UgcReport[]): UgcReport[] {
  if (raw.length > 24_000) fail('reports', 'REPORTS_TOO_LARGE', '上报批次过大');
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail('reports', 'INVALID_JSON', '模型上报不是 JSON'); }
  return validateReportBatch(data, preset);
}
