import assert from 'node:assert/strict';
import * as node from '../src/scenario-generation/bundle.ts';
import { getTemplate as nodeTemplate } from '../src/scenario-generation/templates.ts';
import { generationPrompt as nodePrompt } from '../server/generation-provider.ts';
import * as cloud from '../cloud-verify/functions/d5-bundle.mjs';
import { getTemplate as cloudTemplate } from '../cloud-verify/functions/d5-data.mjs';

const requests = [];
for (const template of ['TPL-NIGHT-DORM-01', 'TPL-LAB-LEAK-01', 'TPL-GYM-CROWD-01']) {
  const mods = nodeTemplate(template).modifiers;
  requests.push({ run_id: 'port-check-' + template, request_id: 'req-' + template, template_id: template, modifiers: [...mods] });
}

for (const request of requests) {
  const template = nodeTemplate(request.template_id);
  const preset = template.preset;
  const a = node.fallbackResult(request, null);
  const b = cloud.fallbackResult(request, null);
  assert.equal(JSON.stringify(a.bundle), JSON.stringify(b.bundle), 'preset bundle differs for ' + request.template_id);
  assert.equal(JSON.stringify(a.request), JSON.stringify(b.request));

  const building = Object.keys(template.routes).at(-1);
  const road = template.routes[building].at(-1);
  const candidate = {
    start_building_id: building, road_id: road,
    first_report_at: preset.first_report_at + 3, confirmed_at: preset.confirmed_at + 3,
    escalation_at: preset.escalation_at + 3, t_end: preset.t_end + 3,
    perspective: preset.perspective === 'staff' ? 'witness' : 'staff',
  };
  assert.ok(node.validateCandidate(candidate, request));
  const na = node.assembleBundle(request, candidate, 'generated');
  const cb = cloud.assembleBundle(request, candidate, 'generated');
  assert.equal(JSON.stringify(na), JSON.stringify(cb), 'generated bundle differs for ' + request.template_id);
  assert.equal(JSON.stringify(node.validateBundle(cb, request, 'generated')), JSON.stringify(cb));
  assert.equal(JSON.stringify(cloud.validateBundle(na, request, 'generated')), JSON.stringify(na));
  assert.equal(JSON.stringify(node.referenceActions(na)), JSON.stringify(cloud.referenceActions(cb)));
  assert.equal(nodePrompt(request), cloud.generationPrompt(request), 'prompt differs for ' + request.template_id);
}
console.log('D5 cloud port matches Node implementation for', requests.length, 'templates, presets and generated candidates');
