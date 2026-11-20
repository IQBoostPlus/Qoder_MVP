import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateRequest, ValidationError } from '../src/scenario-generation/bundle.ts';
import { getTemplate } from '../src/scenario-generation/templates.ts';
import { GenerationLedger } from './generation-ledger.ts';
import { createGenerationService } from './generation-service.ts';
import { ProviderError, qoderProvider, type GenerationProvider } from './generation-provider.ts';

export const generationPath = '/api/d5/scenario';

function simulated(mode: string): GenerationProvider {
  const requests = new Map<string, Parameters<GenerationProvider['prepare']>[0]>();
  return {
    name: 'simulated',
    async prepare(request) {
      const id = crypto.randomUUID();
      requests.set(id, request);
      return id;
    },
    async send(id) {
      const request = requests.get(id)!;
      requests.delete(id);
      if (mode === 'unauthorized') throw new ProviderError('unauthorized', true);
      const template = getTemplate(request.template_id)!;
      const start = Object.keys(template.routes).at(-1)!;
      return JSON.stringify({
        ...template.preset, start_building_id: start, road_id: template.routes[start]!.at(-1),
        first_report_at: template.preset.first_report_at + 5,
        confirmed_at: template.preset.confirmed_at + 10,
        perspective: template.preset.perspective === 'staff' ? 'witness' : 'staff',
      });
    },
  };
}

export function createScenarioHttp(environment: NodeJS.ProcessEnv, allowQoder = false) {
  const { D5_SIMULATE, D5_LEDGER_PATH, D5_ENABLE_QODER, QODER_ACCESS_TOKEN, QODER_AGENT_ID, QODER_ENVIRONMENT_ID } = environment;
  const permitQoder = allowQoder && D5_ENABLE_QODER === '1' && D5_LEDGER_PATH && D5_LEDGER_PATH !== ':memory:' &&
    QODER_ACCESS_TOKEN && QODER_AGENT_ID && QODER_ENVIRONMENT_ID;
  const provider = D5_SIMULATE === 'valid' || D5_SIMULATE === 'unauthorized' ? simulated(D5_SIMULATE)
    : permitQoder ? qoderProvider({ token: QODER_ACCESS_TOKEN, agentId: QODER_AGENT_ID, environmentId: QODER_ENVIRONMENT_ID })
      : undefined;
  const ledger = new GenerationLedger(D5_LEDGER_PATH || ':memory:');
  const service = createGenerationService(ledger, provider, 14_500);

  function json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  }

  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== generationPath) { next(); return; }
    if (request.method !== 'POST' && request.method !== 'GET') {
      json(response, 405, { code: 'METHOD_NOT_ALLOWED' }); return;
    }
    if (request.method === 'POST' && (request.headers['sec-fetch-site'] === 'cross-site' ||
        !request.headers['content-type']?.startsWith('application/json'))) {
      json(response, 415, { code: 'JSON_SAME_ORIGIN_REQUIRED' }); return;
    }
    try {
      let input: unknown;
      if (request.method === 'POST') {
        let body = '';
        for await (const chunk of request) {
          body += String(chunk);
          if (body.length > 2048) { json(response, 413, { code: 'BODY_TOO_LARGE' }); return; }
        }
        try { input = JSON.parse(body); } catch { json(response, 400, { code: 'INVALID_JSON' }); return; }
      } else {
        input = {
          run_id: url.searchParams.get('run_id'), request_id: url.searchParams.get('request_id'),
          template_id: url.searchParams.get('template_id'), modifiers: url.searchParams.getAll('modifiers'),
        };
      }
      const validated = validateRequest(input);
      const reply = request.method === 'GET' ? await service.recover(validated) : await service.generate(validated);
      json(response, reply.status === 'pending' ? 202 : reply.status === 'missing' ? 404 : 200, reply);
    } catch (error) {
      if (error instanceof ValidationError) json(response, 400, { issue: error.issue });
      else json(response, 503, { code: 'GENERATION_UNAVAILABLE' });
    }
  }
  return { handle, close: () => ledger.close() };
}
