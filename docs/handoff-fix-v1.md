# FIX-v1 · B 匿名剧本单次公网验收

**A 交付本地修复，公网判定由 B 在指定的 public 测试部署执行。** 本实验允许 1 个指定生成轮次、最多发送 1 条模型消息。请使用拥有发布权限的独立测试站及其持久数据库，避免复用正在接收模型请求的旧部署。预置版可以在模型关闭时照常体验和保存。

## 1. 准备指定浏览器与轮次

1. 在 B 管理的测试站核对为 public。用一个全新、未登录 Qoder 的浏览器窗口打开该站首页。保持同一个窗口、标签页和站点域名，先留在剧本选择页。
2. 确认地址栏是测试站后，在该页开发者工具执行下段代码。它用与现有轮次访问密钥相同的 32 字节随机生成法，保存到当前站点本机存储。剪贴板只得到 `轮次 ID:SHA-256 摘要`。将该值交给站点所有者填进 Secret，不复制浏览器 Storage、请求头或 HAR。

```js
const runId = crypto.randomUUID();
const hex = (bytes) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const key = hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))));
localStorage.setItem('campus-d6.key.' + runId, key);
sessionStorage.setItem('campus-drill-generation-test-run-v1', runId);
copy(runId + ':' + digest);
console.info('指定测试轮次已准备，配置值已复制');
```

这段准备代码只执行一次。刷新同一标签页仍保留指定轮次。关闭窗口、清除浏览器存储或重新运行会更换凭证，已经写入台账的额度不会重置。首次 POST 与后续轮询、查询请求均使用同一个 `X-Run-Key`。按「开始预置训练」时会独立建立预置轮次。

## 2. 构建、配置、发布前核对

```powershell
npm run check:d7
npm run build
npm run build:sites:d6
npm run check:fix:v1
```

- 将本次源码合入 B 的集成版后重建。独立测试站的静态根可用 `cloud-verify/dist/d6`，Function 用 `cloud-verify/functions`，业务地址为 `/functions/v1/app/api/d5/scenario`。如果测试站已有其他入口，使用其保留全部入口的完整静态根。发布完成后核对浏览器实际加载的新构建和 Function 发布回执。
- 核对 Function `app` 的私有 Storage 与数据库 `read_write` 绑定。沿用 D5 三表及主键，已有表无需迁移。没有表、主键未核对、或固定台账根已有记录时停止实发。使用所有者的数据库管理入口检查固定根 `d5-anonymous-experiment-v1` 在三张 D5 表中的记录数。只记录行数与槽位事件，不复制 `request_json` 和 `session_id`。 [表结构](../db/migrations/d5-generation-ledger-baseline.sql) · [新站迁移顺序](../db/README.md#d5-与-d6-增量)
- 在 Site Settings 配置并在 Function 发布中声明 `D5_ENABLE_ANON_EXPERIMENT=1`、`D5_ANON_EXPERIMENT_BINDING`（上一步摘要）与已有 Qoder Cloud Agent 凭证 `QODER_PAT`。保持 `D5_ENABLE_QODER`、`D6_ENABLE_REPORTS`、`D7_ENABLE_REVIEW`、`D5_ENABLE_TEST_ROUTES` 为 `0` 或缺省。D6 保存可单独保持 `D6_ENABLE_RUN_SYNC=1`。让发布完成并确认这些配置已作用于实际域名后再点击。
- 检查测试域名下只有修复版能够实发。应用在实验开启时连带关闭旧 D5 生成、D7 点评、D5 warm 与 D1/D2/D5 模型发送测试入口，即使对应旧开关误设为 `1`。诊断与历史统计仍按原权限。已登录且可访问诊断时可核对 `anonymous_experiment_enabled=true`、`real_generation_enabled=false`。`GET models` 有回执也只证明连通。

## 3. 只从普通页面提交一次并取证

1. 用已准备的匿名窗口选「夜宿火情」，点击一次「请求 AI 剧本」。期望看到「AI 剧本 · 预置上报」。记下 HTTP 状态、脱敏生成轮次和请求标识、`selection`、`provider`、`report_source`、`calls`、`upstream_state`，以及候选是否校验通过。
2. 验收得分是页面加载出合法剧本且 `selection=generated`、`provider=qoder`、`calls=1`。同时需要上游受理或响应的证据，例如响应体的受理确认或原 Session 里的助手响应。保留安全的 `trace.phases.scenario` 信息，包括 Session 缩写、创建响应状态、发送响应状态及回执 ID、`accepted`／`reply_at`，或 GET 恢复返回的 `reply_read`。仅有 `sent_at` 或 `calls=1` 代表名额已占用。
3. 浏览器超时、断流、回执未知时，在模板页只点「查询上次生成」。若已挂载预置轮，可在「工具」中保留该轮导出，再使用原参数执行同源 GET。在 Network 面板只取响应或脱敏字段。结果未知也算占用，保留原 Session，禁止再次点击提交、更换编号或清台账。
4. 读回必须使用原生成 `run_id`、`request_id`、模板及修饰项。成功时比较 POST 与 GET 的 `result`。已知原请求后，可在原窗口执行下段只读查询。它只输出响应中的非凭证字段。

```js
const pending = JSON.parse(sessionStorage.getItem('campus-drill-generation-v1') || 'null')?.pending;
const active = localStorage.getItem('campus-d6.active');
const saved = JSON.parse(localStorage.getItem('campus-d6.run.' + active) || 'null');
const original = pending ?? saved?.origin?.request;
if (!original || original.run_id !== sessionStorage.getItem('campus-drill-generation-test-run-v1')) {
  throw new Error('当前标签页没有原实验请求');
}
const runKey = localStorage.getItem('campus-d6.key.' + original.run_id);
if (!/^[0-9a-f]{64}$/.test(runKey ?? '')) throw new Error('本机缺少原轮密钥');
const params = new URLSearchParams({ run_id: original.run_id, request_id: original.request_id, template_id: original.template_id });
for (const modifier of original.modifiers) params.append('modifiers', modifier);
const response = await fetch('/functions/v1/app/api/d5/scenario?' + params, {
  headers: { 'X-Run-Key': runKey }, cache: 'no-store', redirect: 'error',
});
const body = await response.json();
const { selection, provider, report_source, calls, fallback_reason, upstream_state } = body.result ?? body;
console.info({ http: response.status, status: body.status, selection, provider, report_source, calls, fallback_reason, upstream_state, trace: body.trace });
```

| 公网结果 | 登记方式 |
| --- | --- |
| 上游有受理或能读到助手响应，合法生成挂载且独立 GET 一致 | 匿名剧本生成通过。记录 action／deployment、实际脚本、脱敏关联、状态码和一槽记录。 |
| 上游受理，候选无效并回退 | 匿名调用链通过，产品生成未通过。保留候选验证错误与同轮痕迹。 |
| 权限、资源准备或结果未知 | 记录最后成功阶段，按回执区分。结果未知只读恢复。 |

## 4. 关闭并回执

将 `D5_ENABLE_ANON_EXPERIMENT` 与 `D5_ENABLE_QODER` 置 `0` 并重新发布关闭版，以实际域名新版本为准。平台若要求去掉启用值或禁止删除在用 Secret，先发布不再声明启用项的版本，再移除不使用的配置。保留台账与已完成轮次。核对匿名原入口 GET 已回到普通授权检查，诊断可用时确认两个开关均关。用预置五步运行并导出，带原轮次凭证的 D6 保存、历史 GET 和复算仍可用。对照关闭前后台账，确认没有新增 `sent`。关闭版如有疑问直接用只读 GET 探测。

## 5. 代码归属与下一阶段

- [Sites 分发](../cloud-verify/functions/routes.mjs) 仅让实验开关打开时的 D5 剧本 POST／GET 走轮次权限。服务端先核对 owner 预设摘要、运行编号、同源和现有请求格式，再接生成逻辑。客户端通过 [原生成适配器](../src/scenario-generation/client.ts) 使用本机轮次密钥。
- [生成服务](../cloud-verify/functions/d5-service.mjs) 用独立的应用级资源命名空间准备 Agent／Environment。实验数据库根固定归站点数据库，`request_json` 绑定原请求与密钥摘要。只有 `scenario` 能占槽；唯一 `sent` 行成功后才调用上游。多个实例、重启、替换请求、修改指定配置都复用该根。历史 Storage 只用于旧路径和实验记录凭证，实验额度不回退到 Storage。发送后落结果失败仍可查询原 Session。名额不得重新释放。
- 学员保存的 `StoredRun.run_id` 是新 UUID，`origin.request.run_id` 保留生成根的原业务 ID，`origin.request.request_id` 保留关联。本轮用它说明原账本归属。后续接整批上报、点评和共享重试时，需要根据可信快照及本次绑定映射回同一服务端账本。当前 D7 仍按已有平台身份保护。
- 阶段一公网通过后再验三件事。先开放访客自助轮次并加比赛期整站额度，再接 D6 整批上报与实际来源，最后补提交后的后台保存及 D7 复盘，8 秒保留摘要。每步独立给证据。

## 6. FIX-v2 在原测试站复验

沿用原实验 action `253fe21f…` 的站点、匿名标签页、轮次绑定、模型凭证及固定台账根 `d5-anonymous-experiment-v1`。发布前先核对三张台账表。若已有记录，只查原请求状态。确认三表为零后，只更新 FIX-v2 Function 并声明以下配置值，保留既有静态入口与实验配置。记录新版发布编号和原 action 的对应关系，确认实际域名命中新版，复核三表行数。

```text
D5_ANON_EXPERIMENT_PUBLIC_ORIGIN=https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone
```

### P1 同源错钥 POST

在原匿名页面执行以下片段。浏览器会自然附上 Origin 和 Fetch Metadata。片段只读取指定轮次编号，固定使用 64 个零作为错钥。

```js
await (async () => {
  if (location.origin !== 'https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone') throw new Error('请回到原实验站');
  const runId = sessionStorage.getItem('campus-drill-generation-test-run-v1');
  if (!/^[\w-]{12,80}$/.test(runId ?? '')) throw new Error('原标签页未保存指定轮次');
  const response = await fetch('/functions/v1/app/api/d5/scenario', {
    method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Run-Key': '0'.repeat(64) },
    body: JSON.stringify({ run_id: runId, request_id: crypto.randomUUID(), template_id: 'TPL-NIGHT-DORM-01', modifiers: ['night', 'heavy_rain'] }),
  });
  const data = await response.json().catch(() => null);
  console.info({ http: response.status, code: data?.code ?? data?.error?.code ?? null });
})();
```

预期从原来的 `415 same_origin_required` 变为业务 `404 not_found`，固定根三表仍是 0 行。取证只记响应、Origin 与 `Sec-Fetch-Site`。若仍是 415，停止真实点击，先查实际版本和配置是否生效。只有仍无法定位时，临时记录 Function 侧两个比较布尔值（是否匹配配置、是否匹配内部 URL origin），核对后移除。

### P2 外源错钥负例

在 PowerShell 7 中把占位符换成原指定轮次编号。此探针只送固定错钥与外站 Origin。

```powershell
$runId = '<原指定轮次 ID>'
if ($runId -notmatch '^[\w-]{12,80}$') { throw '请填原轮次编号' }
$probe = @{
  run_id = $runId
  request_id = [guid]::NewGuid().ToString()
  template_id = 'TPL-NIGHT-DORM-01'
  modifiers = @('night', 'heavy_rain')
} | ConvertTo-Json -Compress
$response = Invoke-WebRequest -Uri 'https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone/functions/v1/app/api/d5/scenario' `
  -Method Post -ContentType 'application/json' -Body $probe -MaximumRedirection 0 -SkipHttpErrorCheck `
  -Headers @{ Origin = 'https://outside.invalid'; 'X-Run-Key' = ('0' * 64) }
$data = try { $response.Content | ConvertFrom-Json -ErrorAction Stop } catch { $null }
[pscustomobject]@{ http = [int]$response.StatusCode; code = ($data.code ?? $data.error.code) }
```

预期业务 `415 same_origin_required`，固定根三表仍为零。若平台返回 `403 BOT_DETECTED`，记「平台先拦截，公网负例未观测」，保留本地外源负例作为应用证据。若到达业务层却返回 404 或成功，暂停实发并检查校验。

### P3 原轮只读查询与唯一实发

1. 使用 §3 的同源 GET 方法，在原窗口带原轮密钥查询。若有原失败请求，沿用它的编号、模板和修饰项。若无请求可恢复且台账记录为零，可仅为 GET 指定一个未占槽的查询编号。预期业务 `404` 且响应 `status=missing`，固定根三表为零。不要把真实密钥放进 URL、截图、HAR 或控制台输出。
2. P1 与 P3 符合预期、P2 已按实际结果注明且无业务异常后，在原页面点击一次「请求 AI 剧本」。预期「AI 剧本 · 预置上报」。超时、断流、无效候选或 `sent` 已出现后，用原生成请求的参数只读恢复。按 §4 重新发布关闭版，对比台账确认关闭后无新增发送。
3. 分别记录同源与生成。前者需要旧 415、新业务 404、P2 观察结论、P3 和零写入。后者另需上游受理或助手响应、合法候选挂载、`generated/qoder/calls=1`、按原请求读回一致，且台账仅一条 `sent`。按各自的时间、版本和执行人把真实结果追加到 B 原凭证 §B5 后。也可从 [FIX-v2 A 轨记录](qoder-evidence/FIX-2026-11-24-v2-hosted-origin.md) 回到本操作单。
