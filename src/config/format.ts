export function formatSimTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function simStamp(seconds: number): string {
  return `T+${formatSimTime(seconds)}`;
}

export function seqLabel(seq: number): string {
  return `第 ${seq} 条操作`;
}

// 静态封闭没有来源操作（closed_by_action_seq 为 null），此时只给时刻，不编造操作引用。
export function closedStamp(atSim: number | null, bySeq: number | null): string {
  const parts: string[] = [];
  if (atSim !== null) parts.push(simStamp(atSim));
  if (bySeq !== null) parts.push(seqLabel(bySeq));
  return parts.join(' · ');
}