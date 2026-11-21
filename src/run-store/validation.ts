import type { RunEvent, VerdictAttempt } from '../contracts';
import { createEnginePort } from '../engine-port';
import { record } from '../scenario-generation/bundle';
import type { RunProgress, StoredRun } from './contracts';
import { RunStoreError } from './contracts';

export function stable(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) => record(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const whole = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{12,80}$/.test(value);
function requireRun(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RunStoreError('CORRUPT', message);
}

export function newProgress(speed: number): RunProgress {
  return { node: 0, furthest: 0, started: false, finished: false, speed, elapsed_ms: 0 };
}

export function validateRun(input: unknown): StoredRun {
  try {
    requireRun(record(input), '轮次记录格式无效');
    if (input.schema_version !== 1 || input.engine_version !== 'd4-1' || input.map_version !== 'd2-1') {
      throw new RunStoreError('VERSION', '轮次、地图或评分版本不受支持');
    }
    requireRun(identifier(input.run_id) && whole(input.revision) && input.revision > 0 &&
      typeof input.created_at === 'string' && typeof input.updated_at === 'string' &&
      Number.isFinite(Date.parse(input.created_at)) && Date.parse(input.updated_at) >= Date.parse(input.created_at), '轮次头信息无效');
    requireRun(record(input.bundle) && record(input.map) && record(input.progress) && Array.isArray(input.events), '轮次缺少题目包、地图、进度或事件');
    const run = input as unknown as StoredRun;
    const { scenario, ugc_reports: reports } = run.bundle;
    requireRun(record(scenario) && scenario.id === run.scenario_id && Array.isArray(scenario.nodes) &&
      Array.isArray(reports) && reports.length === 10 && Array.isArray(run.bundle.action_catalog), '冻结题目包无效');
    const times = scenario.nodes.map((node) => node.t_sim);
    requireRun(times.length > 0 && whole(scenario.t_end) && scenario.t_end > 0 && times.at(-1) === scenario.t_end &&
      times.every((time, index) => whole(time) && (index === 0 || time > times[index - 1]!)) &&
      new Set(scenario.nodes.map(({ id }) => id)).size === times.length, '场景节点或时间无效');
    const engine = createEnginePort(run.bundle, run.map);
    const buildingIds = new Set(engine.map.buildings.map(({ id }) => id));
    const roadIds = new Set(engine.map.road_segments.map(({ id }) => id));
    requireRun(buildingIds.has(scenario.start_building_id), '起始楼栋不存在');
    const postings = new Map<string, number>();
    for (const node of scenario.nodes) for (const event of node.events) {
      if (event.type === 'ugc_appear') {
        requireRun(!postings.has(event.report_id), '上报重复投放');
        postings.set(event.report_id, node.t_sim);
      } else if (event.type === 'road_hazard') requireRun(roadIds.has(event.road_id), '路段不存在');
      else requireRun(event.type === 'disaster_confirm' && buildingIds.has(event.building_id), '灾情对象不存在或类型无效');
    }
    const byReport = new Map(reports.map((report) => [report.id, report]));
    requireRun(byReport.size === 10 && postings.size === 10 && new Set(reports.map(({ priority }) => priority)).size === 10, '上报 ID、投放或优先级重复');
    for (const report of reports) {
      requireRun(report.is_training === 1 && typeof report.text === 'string' && report.text.length > 0 &&
        whole(report.priority) && report.priority > 0 && postings.get(report.id) === report.appears_at_sim &&
        typeof report.event_truth.is_real === 'boolean' && typeof report.event_truth.locatable === 'boolean' &&
        (report.event_truth.locatable ? buildingIds.has(report.event_truth.building_id ?? '') : report.event_truth.building_id === null), '上报标签或引用无效');
      const windows = report.judgment_windows;
      requireRun(windows.length > 0 && windows[0]?.from_sim === report.appears_at_sim &&
        windows.every((window, index) => ['真报','误报','待核'].includes(window.expected) && typeof window.reason === 'string' &&
          (index === windows.length - 1 ? window.to_sim === null : window.to_sim === windows[index + 1]?.from_sim &&
            window.to_sim! > window.from_sim && window.to_sim! <= scenario.t_end)), '判断窗口无效');
    }
    const p = run.progress;
    requireRun(whole(p.node) && whole(p.furthest) && p.node <= p.furthest && p.furthest < times.length &&
      scenario.playback_speeds.includes(p.speed) && whole(p.elapsed_ms) && typeof p.started === 'boolean' &&
      typeof p.finished === 'boolean' && (!p.finished || p.started && p.furthest === times.length - 1) &&
      (p.started || p.furthest === 0 && !p.elapsed_ms && !run.events.length), '训练进度或时钟无效');
    const seenVerdicts = new Map<string, number>();
    let previousTime = -1;
    let sorted = false;
    const prior: RunEvent[] = [];
    for (const entry of run.events) {
      requireRun(record(entry) && record(entry.payload) && entry.seq === prior.length + 1 && entry.payload.seq === entry.seq &&
        times.includes(entry.t_sim) && entry.t_sim >= previousTime && entry.t_sim <= times[p.furthest]!, '流水序号或时刻无效');
      if (entry.kind === 'verdict') {
        const v: VerdictAttempt = entry.payload;
        const report = byReport.get(v.report_id);
        requireRun(report && report.appears_at_sim <= entry.t_sim && v.judged_at_sim === entry.t_sim &&
          ['真报','误报','待核'].includes(v.verdict) && (v.location === null || v.location === '无法定位' || buildingIds.has(v.location)) &&
          v.supersedes_seq === (seenVerdicts.get(v.report_id) ?? null), '判读或改判引用无效');
        seenVerdicts.set(v.report_id, entry.seq);
      } else if (entry.kind === 'action') {
        const expected = engine.judgeAction({ action_id: entry.payload.action_id, target_id: entry.payload.target_id,
          submitted_at_sim: entry.t_sim, seq: entry.seq, prior_events: prior });
        // Reasons are presentation copy; codes, durations, resource intervals and IDs remain authoritative.
        requireRun(same({ ...expected, reject_reason: entry.payload.reject_reason }, entry.payload), '动作完成、拒绝或资源流水不一致');
      } else {
        requireRun(entry.kind === 'sort' && !sorted && entry.t_sim === scenario.t_end && entry.payload.t_sim === entry.t_sim &&
          Array.isArray(entry.payload.ordered_report_ids) && entry.payload.ordered_report_ids.length === 3 &&
          new Set(entry.payload.ordered_report_ids).size === 3 && entry.payload.ordered_report_ids.every((id) => byReport.has(id)), '末回合排序无效');
        sorted = true;
      }
      prior.push(entry);
      previousTime = entry.t_sim;
    }
    const score = p.finished ? engine.scoreRound(run.events) : null;
    requireRun(same(run.score, score), '评分缓存与流水复算不一致');
    return run;
  } catch (error) {
    if (error instanceof RunStoreError) throw error;
    throw new RunStoreError('CORRUPT', '冻结题目或学员流水无法校验');
  }
}

export function assertRunUpdate(previous: StoredRun, next: StoredRun): void {
  if (next.revision !== previous.revision + 1 || next.created_at !== previous.created_at ||
      Date.parse(next.updated_at) < Date.parse(previous.updated_at) ||
      !same(next.bundle, previous.bundle) || !same(next.map, previous.map) || !same(next.origin, previous.origin) ||
      next.events.length < previous.events.length || !same(previous.events, next.events.slice(0, previous.events.length)) ||
      next.progress.furthest < previous.progress.furthest || next.progress.elapsed_ms < previous.progress.elapsed_ms ||
      previous.progress.started && !next.progress.started ||
      previous.progress.finished && (!next.progress.finished || next.events.length !== previous.events.length ||
        next.progress.elapsed_ms !== previous.progress.elapsed_ms)) {
    throw new RunStoreError('CONFLICT', '轮次版本、题目或已有流水发生冲突，请刷新读取最新记录');
  }
}
