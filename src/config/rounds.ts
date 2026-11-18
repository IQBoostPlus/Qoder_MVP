import type { Scenario, ScenarioNode } from '../contracts';

export type RoundKind = 'event' | 'advance' | 'final';

export const ROUND_KIND_LABEL: Record<RoundKind, string> = {
  event: '事件回合',
  advance: '推进回合',
  final: '末回合',
};

export interface RoundInfo {
  index: number;
  node: ScenarioNode;
  kind: RoundKind;
  kindLabel: string;
}

/** 回合序列完全由 scenario.nodes 派生；推进回合 = 无事件且非 t_end，末回合 = t_end。不写死时刻。 */
export function deriveRounds(scenario: Scenario): RoundInfo[] {
  return scenario.nodes.map((node, index) => {
    const kind: RoundKind =
      node.t_sim === scenario.t_end ? 'final' : node.events.length === 0 ? 'advance' : 'event';
    return { index, node, kind, kindLabel: ROUND_KIND_LABEL[kind] };
  });
}

export const DRILL_MODE_BADGE = 'fixture 推演 · 实时评分待 D4';
export const DRILL_SKELETON_BADGE = 'fixture 骨架演示';
export const ENGINE_PENDING_LABEL = '待引擎接入';