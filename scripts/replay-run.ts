import { readFile, writeFile } from 'node:fs/promises';
import canonical from '../fixtures/canonical-run.json';
import type { CanonicalFixture } from '../src/contracts';
import { createEnginePort } from '../src/engine-port';
import { exportRun, importRun, newRun, updateRun } from '../src/run-store/local';
import { campusMap } from '../src/scenario-generation/templates';

async function writeExample(path: string): Promise<void> {
  const { scenario, action_catalog, ugc_reports, runs } = canonical as CanonicalFixture;
  const bundle = { scenario, action_catalog, ugc_reports };
  const run = newRun({ bundle, map: campusMap, origin: null }, 'd8-example-run-jia-1x');
  const example = runs.find(({ run_id }) => run_id === 'run-jia-1x');
  if (!example) throw new Error('找不到甲分支演练样例。');
  const { events } = example;
  const last = scenario.nodes.length - 1;
  const score = createEnginePort(bundle, campusMap).scoreRound(events);
  const finished = updateRun(run, { ...run.progress, node: last, furthest: last, started: true, finished: true }, events, score);
  await writeFile(path, exportRun(finished) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log('已写出固定演练样例（无真人操作）：' + path);
}

async function replay(path: string): Promise<void> {
  const run = importRun((await readFile(path, 'utf8')).trimStart());
  if (!run.progress.finished) throw new Error('请选择已结算的轮次导出 JSON。');
  const score = createEnginePort(run.bundle, run.map).scoreRound(run.events);
  console.log(JSON.stringify({
    run_id: run.run_id,
    scenario_id: run.scenario_id,
    template_id: run.bundle.scenario.template_id,
    scenario_source: run.bundle.scenario.source,
    report_source: run.origin?.report_source ?? 'preset',
    revision: run.revision,
    events: run.events.length,
    simulation_end_seconds: run.bundle.scenario.t_end,
    operation_elapsed_ms: run.progress.elapsed_ms,
    score: {
      discrimination: score.discrimination, response: score.response, coverage: score.coverage,
      violation: score.violation, total: score.total,
    },
    details: score.details,
    location: score.location,
    sorting: score.sorting,
    validated: true,
  }, null, 2));
}

const args = process.argv.slice(2);
try {
  if (args.length === 2 && args[0] === '--sample') await writeExample(args[1]!);
  else if (args.length === 1 && !args[0]!.startsWith('--')) await replay(args[0]!);
  else throw new Error('用法：npx --no-install tsx scripts/replay-run.ts <已结算 JSON> 或 --sample <新文件路径>');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
