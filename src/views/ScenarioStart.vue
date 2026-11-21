<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue';
import { fallbackResult } from '../scenario-generation/bundle';
import { completeSessionGeneration, readGenerationSession, requestScenario, reserveSessionGeneration } from '../scenario-generation/client';
import { SESSION_LIMIT, type FallbackReason, type GenerationRequest, type GenerationResult, type Modifier, type TemplateId } from '../scenario-generation/contracts';
import { getTemplate, templates } from '../scenario-generation/templates';

const emit = defineEmits<{ start: [result: GenerationResult]; canonical: [] }>();
const chosen = ref<TemplateId>(templates[0]!.id);
const template = computed(() => getTemplate(chosen.value)!);
const phase = ref('');
const count = ref(0);
const pending = ref<GenerationRequest | null>(null);
const storageProblem = ref(false);
let inFlight: AbortController | null = null;

const modifierLabels: Record<Modifier, string> = { night: '夜间值班', heavy_rain: '暴雨加强', comms_outage: '通信延迟', crowd_peak: '散场高峰' };
const reasonText: Record<FallbackReason, string> = {
  not_configured: '生成服务未启用', unauthorized: '生成服务授权失败', network: '生成服务无法连接或结果未返回',
  timeout: '等待已达 15 秒', invalid_candidate: '生成结果未通过校验', budget: '本轮调用预算不足', conflict: '请求标识冲突',
};

function refreshSession(): void {
  try {
    const state = readGenerationSession(sessionStorage);
    pending.value = state.pending;
    count.value = state.count;
  } catch { storageProblem.value = true; }
}
refreshSession();

function abandonWait(): void {
  inFlight?.abort();
  inFlight = null;
  phase.value = '';
}
onScopeDispose(abandonWait);

function choose(id: TemplateId): void {
  if (chosen.value === id) return;
  abandonWait();
  chosen.value = id;
}

function request(): GenerationRequest {
  return {
    run_id: crypto.randomUUID(), request_id: crypto.randomUUID(), template_id: template.value.id,
    modifiers: [...template.value.modifiers],
  };
}

function startPreset(): void {
  abandonWait();
  emit('start', fallbackResult(request(), null));
}

async function generate(recover: boolean): Promise<void> {
  if (inFlight) return;
  const input = recover ? pending.value : request();
  if (!input) return;
  if (!recover) {
    try {
      const reserved = reserveSessionGeneration(sessionStorage, input);
      if (!reserved) return;
      count.value = reserved.count;
      pending.value = reserved.pending;
    } catch { storageProblem.value = true; return; }
  }
  const controller = new AbortController();
  inFlight = controller;
  phase.value = recover ? '查询原生成请求' : '正在生成剧本';
  const result = await requestScenario(input, recover, controller.signal, () => {
    if (inFlight === controller) phase.value = '正在校验剧本与上报';
  });
  if (inFlight !== controller) return;
  if (result.upstream_state !== 'unknown') {
    try { completeSessionGeneration(sessionStorage, input); refreshSession(); }
    catch { storageProblem.value = true; }
  }
  inFlight = null;
  if (result.fallback_reason) phase.value = reasonText[result.fallback_reason] + '，正在载入预置剧本';
  emit('start', result);
}
</script>

<template>
  <section class="scenario-start rail-sec" aria-labelledby="scenario-picker-title">
    <h2 id="scenario-picker-title">选择推演剧本</h2>
    <label class="control">
      <span class="control-label">训练模板</span>
      <select :value="chosen" aria-label="训练模板" @change="choose(($event.target as HTMLSelectElement).value as TemplateId)">
        <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <p>{{ template.description }}</p>
    <ul>
      <li v-for="variable in template.variables" :key="variable">{{ variable }}</li>
    </ul>
    <p v-if="template.modifiers.length" class="note">训练背景 · {{ template.modifiers.map((option) => modifierLabels[option]).join('、') }}</p>
    <div class="scenario-controls">
      <button class="btn btn-primary" @click="startPreset">开始预置训练</button>
      <button class="btn" :disabled="!!phase || count >= SESSION_LIMIT || storageProblem" @click="generate(false)">请求 AI 剧本</button>
      <button v-if="pending" class="btn" :disabled="!!phase" @click="generate(true)">查询上次生成</button>
      <button class="btn" @click="emit('canonical')">开始 D4 标准训练</button>
    </div>
    <p class="note" role="status">{{ phase || (storageProblem ? '无法保存本次会话的生成次数。可直接开始预置训练。' : '本页会话生成 ' + count + '/' + SESSION_LIMIT + ' 次 · 可直接使用预置训练') }}</p>
  </section>
</template>

<style scoped>
.scenario-start { display: flex; max-width: 620px; margin: 12px auto 24px; }
.scenario-start h2, .scenario-start p, .scenario-start ul { margin: 0; }
.scenario-start .control { min-height: 44px; min-width: 0; }
.scenario-start select { flex: 1; min-width: 0; }
.scenario-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.scenario-controls .btn { min-height: 44px; }
</style>
