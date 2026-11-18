import type { ReplaySnapshot } from '../fixture-port';

// 键为语义图层名，不是楼栋/路段 id；D2 补 20 栋时此表零改动。
export type LayerKey = 'disaster' | 'cordon' | 'rescue';

export const LAYER_ORDER: LayerKey[] = ['disaster', 'cordon', 'rescue'];

export interface LayerStyle {
  label: string;
  desc: string;
  color: string;
  soft: string;
  edge: string;
}

export const LAYER_STYLE: Record<LayerKey, LayerStyle> = {
  disaster: {
    label: '灾情',
    desc: '蓝色「!」标注 + 灾情标题，来自剧本 disaster_confirm 事件，按快照可见性出现。',
    color: 'var(--blue)',
    soft: 'var(--blue-soft)',
    edge: 'var(--edge-blue)',
  },
  cordon: {
    label: '警戒',
    desc: '琥珀色外圈，来自 A3 警戒动作：布设中显示预计完成时刻，完成后显示已就位。',
    color: 'var(--amber)',
    soft: 'var(--amber-soft)',
    edge: 'var(--edge-amber)',
  },
  rescue: {
    label: '救援队',
    desc: '绿色「+」标注，来自 A2 救援动作，仅在目标楼栋显示在途 / 已到达；不绘制虚构行进轨迹。',
    color: 'var(--green)',
    soft: 'var(--green-soft)',
    edge: 'var(--edge-green)',
  },
};

export type SelectionKind = 'building' | 'road' | 'junction';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export const SELECTION_KIND_LABEL: Record<SelectionKind, string> = {
  building: '楼栋',
  road: '路段',
  junction: '路口·非楼栋',
};

export interface DisasterMark {
  building_id: string;
  title: string;
  at_sim: number;
}

export interface CordonMark {
  building_id: string;
  state: 'placing' | 'ready';
  at_sim: number;
  seq: number;
}

export interface RescueMark {
  building_id: string;
  state: 'enroute' | 'arrived';
  at_sim: number;
  seq: number;
}

export interface MapOverlay {
  disaster: DisasterMark[];
  cordons: CordonMark[];
  rescues: RescueMark[];
}

export const EMPTY_OVERLAY: MapOverlay = { disaster: [], cordons: [], rescues: [] };

/**
 * 只消费快照：scenario_events 已由 replayTo 按可见性截断（t=80 不含 t=90 的灾情确认），
 * 这里不做任何可见性/判断窗推导。同一楼栋多次灾情标注按最新覆盖。
 */
export function deriveLayerMarks(snapshot: ReplaySnapshot | null): MapOverlay {
  if (!snapshot) return EMPTY_OVERLAY;
  const t = snapshot.t_sim;

  const disasterByBuilding = new Map<string, DisasterMark>();
  for (const entry of snapshot.scenario_events) {
    if (entry.event.type === 'disaster_confirm' && entry.event.adds_disaster_annotation) {
      disasterByBuilding.set(entry.event.building_id, {
        building_id: entry.event.building_id,
        title: entry.event.title,
        at_sim: entry.t_sim,
      });
    }
  }

  const cordons: CordonMark[] = [];
  const rescues: RescueMark[] = [];
  for (const action of snapshot.actions) {
    if (action.status !== 'accepted') continue;
    if (action.action_id === 'A3') {
      const done = action.completed_at_sim;
      cordons.push({
        building_id: action.target_id,
        state: done !== null && t >= done ? 'ready' : 'placing',
        at_sim: done ?? action.submitted_at_sim,
        seq: action.seq,
      });
    } else if (action.action_id === 'A2') {
      const done = action.completed_at_sim;
      rescues.push({
        building_id: action.target_id,
        state: done !== null && t >= done ? 'arrived' : 'enroute',
        at_sim: done ?? action.submitted_at_sim,
        seq: action.seq,
      });
    }
  }

  return { disaster: [...disasterByBuilding.values()], cordons, rescues };
}

export function cordonText(mark: CordonMark): string {
  return mark.state === 'ready' ? `警戒已就位 @${mark.at_sim}` : `警戒布设中 · 预计 @${mark.at_sim}`;
}

export function rescueText(mark: RescueMark): string {
  return mark.state === 'arrived' ? `救援队已到达 @${mark.at_sim}` : `救援队在途 · 预计 @${mark.at_sim}`;
}