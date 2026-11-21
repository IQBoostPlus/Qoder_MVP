import type { ActionId, Verdict } from '../contracts';

export const VERDICT_GUIDANCE: Record<Verdict, string> = {
  真报: '线索支持属实',
  误报: '线索指向不实',
  待核: '证据还不够',
};

export const ORDER_EFFECT: Record<ActionId, { working: string; done: string }> = {
  A1: { working: '核查任务执行中', done: '核查任务已结束，可继续留意核实通报。' },
  A2: { working: '救援队正在赶往目标', done: '救援队已抵达目标。' },
  A3: { working: '警戒人员正在布设警戒', done: '目标周边的警戒已就位。' },
  A4: { working: '疏散广播正在执行', done: '疏散广播已完成。' },
  A5: { working: '交通人员正在布设路障', done: '该路段已正式封闭，路径规划会避开。' },
  A6: { working: '电工正在执行断电', done: '目标楼栋已断电。' },
};

export function learnerReportText(text: string): string {
  // 预置样例中的编剧注释不属于上报原文。
  return text.replace(/（(?:实为 [A-Z0-9-]+|重复 U\d+)）$/, '');
}
