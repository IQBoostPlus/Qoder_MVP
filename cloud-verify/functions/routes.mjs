import { createCloudAgentsClient } from './cloud-agents.mjs';
import { createD2Routes } from './d2-verify.mjs';
import { agentDiagnosticEnabled, agentDiagnosticPath, anonymousExperimentEnabled, publicScenariosEnabled, createD5Routes, envEnabled } from './d5-routes.mjs';
import { createRunRoute } from './d6-shared.mjs';

const CLOUD_API_ORIGIN = 'https://api.qoder.com.cn';
const AGENT_PROMPT = 'Reply with exactly: D1_OK';

export function application({ db, storage, requireUser, BackendError }) {
  const handleD2 = createD2Routes({ db, storage, BackendError });
  const handleD5 = createD5Routes({ db, storage, BackendError });
  const handleD6 = createRunRoute(db, () => envEnabled('D6_ENABLE_RUN_SYNC'));
  const agentTestsEnabled = () => !anonymousExperimentEnabled() && !agentDiagnosticEnabled() && envEnabled('D5_ENABLE_QODER') && envEnabled('D5_ENABLE_TEST_ROUTES');
  const fail = (code, status) => {
    throw new BackendError(code, status);
  };
  const rows = result => {
    if (result.error) fail(result.error.code, result.error.status);
    return result.data;
  };

  async function runDatabaseCheck() {
    const id = crypto.randomUUID();
    const runId = `d1-cloud-${Date.now()}`;
    rows(await db.from('d1_connectivity_check').insert({
      id,
      run_id: runId,
      note: 'D1 cloud read/write check',
    }));
    const found = rows(await db.from('d1_connectivity_check')
      .select('id,run_id,note,is_training,created_at')
      .eq('id', id)
      .limit(1));
    if (!found?.length || found[0].run_id !== runId) fail('database_read_mismatch', 503);
    return {
      ok: true,
      id,
      run_id: found[0].run_id,
      is_training: found[0].is_training,
      created_at: found[0].created_at,
    };
  }

  async function runAgentCheck() {
    const cloud = createCloudAgentsClient({ origin: CLOUD_API_ORIGIN, diagnostics: () => {} });
    const models = await cloud.request('/api/v1/cloud/models');
    const model = Array.isArray(models?.data)
      ? models.data.find(item => typeof item?.id === 'string' && item.enabled !== false) ?? models.data.find(item => typeof item?.id === 'string')
      : undefined;
    if (!model) fail('ai_model_unavailable', 503);

    const agent = await cloud.request('/api/v1/cloud/agents', {
      method: 'POST',
      idempotencyKey: 'd1-connectivity-agent-v1',
      body: {
        name: 'D1 connectivity check',
        model: model.id,
        system: 'You are a connectivity check. Follow the single instruction exactly.',
      },
    });
    const environment = await cloud.request('/api/v1/cloud/environments', {
      method: 'POST',
      body: { name: 'D1 connectivity environment', config: { type: 'cloud' } },
    });
    if (typeof agent?.id !== 'string' || typeof environment?.id !== 'string') {
      fail('ai_response_invalid', 503);
    }

    const session = await cloud.request('/api/v1/cloud/sessions', {
      method: 'POST',
      body: {
        agent: { type: 'agent', id: agent.id, version: agent.version },
        environment_id: environment.id,
        title: 'D1 connectivity check',
      },
    });
    if (typeof session?.id !== 'string') fail('ai_response_invalid', 503);

    await cloud.request(`/api/v1/cloud/sessions/${session.id}/events`, {
      method: 'POST',
      body: {
        events: [{ type: 'user.message', content: [{ type: 'text', text: AGENT_PROMPT }] }],
      },
    });

    let replyText = '';
    let eventCount = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const history = await cloud.request(`/api/v1/cloud/sessions/${session.id}/events?order=asc&limit=100`);
      const events = Array.isArray(history?.data) ? history.data : [];
      eventCount = events.length;
      replyText = events.flatMap(event => {
        const role = event?.role ?? event?.author?.role ?? event?.type;
        if (role !== 'assistant' && role !== 'agent.message') return [];
        const content = Array.isArray(event?.content) ? event.content : [];
        return content
          .filter(block => block?.type === 'text' && typeof block.text === 'string')
          .map(block => block.text);
      }).join(' ').trim();
      if (replyText) break;
    }

    return {
      ok: replyText.length > 0,
      agent_id: agent.id,
      environment_id: environment.id,
      session_id: session.id,
      event_count: eventCount,
      reply: replyText,
      accepted: true,
    };
  }

  return async ctx => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';

    if (path === '/api/health' && request.method === 'GET') {
      return Response.json({ ok: true });
    }

    if (path === '/api/d6/runs') return handleD6(request);
    if (publicScenariosEnabled() && path === '/api/d5/scenario' && ['GET', 'POST'].includes(request.method)) {
      return handleD5(ctx, path, null);
    }
    if (anonymousExperimentEnabled() && (path === '/api/d5/scenario' && ['GET', 'POST'].includes(request.method) ||
      agentDiagnosticEnabled() && path === agentDiagnosticPath && request.method === 'POST')) {
      return handleD5(ctx, path, null);
    }
    const user = await requireUser(ctx);

    if (path.startsWith('/api/d5/') || path === '/api/d7/review') {
      const response = await handleD5(ctx, path, user);
      if (response) return response;
      fail('not_found', 404);
    }

    if (path.startsWith('/api/d2/')) {
      if ((path === '/api/d2/agent/init' || path === '/api/d2/agent/send') && !agentTestsEnabled()) {
        fail('agent_test_routes_disabled', 404);
      }
      const response = await handleD2(ctx, path, user);
      if (response) return response;
      fail('not_found', 404);
    }

    if (path === '/api/d1/db' && request.method === 'POST') {
      return Response.json(await runDatabaseCheck());
    }
    if (path === '/api/d1/agent' && request.method === 'POST') {
      if (!agentTestsEnabled()) fail('agent_test_routes_disabled', 404);
      return Response.json(await runAgentCheck());
    }

    fail('not_found', 404);
  };
}
