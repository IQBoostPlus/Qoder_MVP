<script setup lang="ts">
import type { ResourceDef, ResourceUsage } from '../contracts';

const props = defineProps<{
  resources: readonly ResourceDef[];
  occupancy: readonly ResourceUsage[];
  active: readonly ResourceUsage[];
}>();

function activeOf(resourceId: string): ResourceUsage | null {
  return props.active.find((u) => u.resource_id === resourceId) ?? null;
}
function intervalsOf(resourceId: string): string {
  const list = props.occupancy.filter((u) => u.resource_id === resourceId);
  if (!list.length) return '本流水无占用记录';
  return list.map((u) => `${u.from_sim}→${u.to_sim ?? '结束'} · seq${u.action_seq}`).join('；');
}
function fillPercent(resourceId: string, capacity: number): number {
  const usage = activeOf(resourceId);
  if (!usage || capacity <= 0) return 0;
  return Math.min(100, (usage.units / capacity) * 100);
}
</script>

<template>
  <div class="occ" id="occupancy-bars">
    <div v-for="res in resources" :key="res.id" class="occ-row" :class="{ busy: activeOf(res.id) !== null }">
      <div class="occ-head">
        <span class="occ-name">{{ res.name }}</span>
        <span class="occ-cap mono">容量 {{ res.capacity }} {{ res.unit }}</span>
        <span class="badge badge-sm" :class="activeOf(res.id) !== null ? 'badge-amber' : 'badge-muted'">
          {{ activeOf(res.id) !== null ? '占用中' : '空闲' }}
        </span>
      </div>
      <div class="occ-track" role="img" :aria-label="`${res.name}：${activeOf(res.id) !== null ? '占用中' : '空闲'}`">
        <span class="occ-fill" :style="{ width: `${fillPercent(res.id, res.capacity)}%` }"></span>
      </div>
      <span class="occ-interval mono">{{ intervalsOf(res.id) }}</span>
    </div>
  </div>
</template>

<style scoped>
.occ { display: flex; flex-direction: column; gap: 8px; }
.occ-row { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; background: var(--ink-950); border: 1px solid var(--line-soft); border-radius: var(--r-md); }
.occ-row.busy { border-color: var(--edge-amber); }
.occ-head { display: flex; align-items: center; gap: 8px; }
.occ-name { font-size: 12.5px; font-weight: 600; }
.occ-cap { font-size: 10.5px; color: var(--muted); }
.occ-head .badge { margin-left: auto; }
.occ-track { height: 6px; border-radius: 3px; background: var(--ink-800); border: 1px solid var(--line-soft); overflow: hidden; }
.occ-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--amber), var(--red)); transition: width 0.2s ease; }
.occ-interval { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>