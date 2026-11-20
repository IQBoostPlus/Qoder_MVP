import { setTimeout as delay } from 'node:timers/promises';
import { candidateSchema, record } from '../src/scenario-generation/bundle.ts';
import { getTemplate } from '../src/scenario-generation/templates.ts';
import type { FallbackReason, GenerationRequest, Issue } from '../src/scenario-generation/contracts';

export class ProviderError extends Error {
  constructor(readonly reason: FallbackReason, readonly definitive = false) { super(reason); }
}

export interface GenerationProvider {
  name: 'simulated' | 'qoder';
  prepare(request: GenerationRequest, signal: AbortSignal): Promise<string>;
  send(session: string, prompt: string, signal: AbortSignal): Promise<string>;
  read?(session: string, signal: AbortSignal): Promise<string | null>;
}

export function generationPrompt(request: GenerationRequest, issue?: Issue): string {
  const template = getTemplate(request.template_id)!;
  return JSON.stringify({
    instruction: '为校园应急训练选择一组剧情事实。仅输出符合 Schema 的单个 JSON 对象，不要 Markdown、命令或文件操作。',
    template: template.description,
    modifiers: request.modifiers,
    allowed_road_by_building: template.routes,
    constraints: ['核实比首报晚至少 25 秒', '事态加剧比核实晚至少 20 秒', '结束比加剧晚至少 45 秒'],
    output_schema: candidateSchema(request),
    previous_validation_issue: issue,
  });
}

const root = 'https://api.qoder.com/api/v1/cloud';
interface QoderConfig { token: string; agentId: string; environmentId: string }

export function qoderProvider(config: QoderConfig, fetchFn = fetch): GenerationProvider {
  async function api(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
    const response = await fetchFn(root + path, {
      signal, redirect: 'error', method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new ProviderError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'network',
        response.status >= 400 && response.status < 500 && response.status !== 408);
    }
    return response.json();
  }
  async function read(session: string, signal: AbortSignal): Promise<string | null> {
    const result = await api('/sessions/' + encodeURIComponent(session) + '/events?limit=10&types=agent.message', signal);
    if (!record(result) || !Array.isArray(result.data)) throw new ProviderError('network');
    const message = result.data.find((event: unknown) => record(event) && (event.type === 'agent.message' || event.role === 'assistant'));
    if (!record(message) || !Array.isArray(message.content)) return null;
    return message.content.flatMap((block: unknown) => record(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('') || null;
  }

  return {
    name: 'qoder',
    read,
    async prepare(request, signal) {
      const session = await api('/sessions', signal, {
        agent: config.agentId, environment_id: config.environmentId, title: 'D5 scenario',
        metadata: { run_id: request.run_id, request_id: request.request_id },
      });
      if (!record(session) || typeof session.id !== 'string' || !/^sess_[a-zA-Z0-9_-]+$/.test(session.id)) {
        throw new ProviderError('network');
      }
      return session.id;
    },
    async send(session, prompt, signal) {
      const path = '/sessions/' + encodeURIComponent(session) + '/events';
      await api(path, signal, { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] });
      for (;;) {
        const text = await read(session, signal);
        if (text) return text;
        await delay(350, undefined, { signal });
      }
    },
  };
}
