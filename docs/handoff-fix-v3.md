# FIX-v3 · B 轨 Agent 创建诊断操作单

本轮 A 只交诊断版和本地替身验收。等单独批准后，由 B 站点所有者在原测试站执行一次。FIX-v2 已验证同源 415 关闭，原 Agent 400 回执仍缺正文。此次取得的回执须标为**新一次调用**。

1. **核对诊断版本和站点。** 在 `campus-drill-anon-test-kqvhf8qsvw2.qoder.zone` 发布 FIX-v3 Function，记录实际 action、部署与文件校验和。沿用原匿名轮次绑定、公开 Origin、私有 Storage 与平台现有 `QODER_PAT`。保留 `D5_ENABLE_ANON_EXPERIMENT=1`，为本次人工操作配置并声明一个新 UUID `D5_ANON_AGENT_DIAGNOSTIC_ID`。其他模型发送开关保持关闭。诊断 ID 有值时，普通匿名剧本入口返回 `503 agent_diagnostic_only`，旧模型发送入口也保持隔离。
2. **只读记录原绑定和台账。** 从所有者的 Storage 管理入口记录原 binding 的状态、revision、是否有 Agent 和 Environment。对物理根 `d5-anonymous-experiment-v1` 查三张 D5 表及 `sent` 行数，保存对账前值。原请求 GET 在切入诊断版前按 [FIX-v1 §3](handoff-fix-v1.md#3-只从普通页面提交一次并取证) 执行，因为诊断版隔离普通 POST 和 GET。对账已有行也保留。`calls=0` 只证明未记发送，D5 正常业务在准备资源前已经尝试 claim。
3. **执行一次资源诊断。** 只在原匿名测试标签页执行以下片段一次。它只向同源的固定诊断入口递交原轮次授权。页面只显示状态和上游关联 ID。若浏览器、发布或平台返回错误，保留回执与当前诊断 ID，查看私有记录，避免重复执行。

```js
await (async () => {
  if (location.origin !== 'https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone') throw new Error('请回到原测试站');
  const runId = sessionStorage.getItem('campus-drill-generation-test-run-v1');
  const runKey = runId && localStorage.getItem('campus-d6.key.' + runId);
  if (!/^[\w-]{12,80}$/.test(runId ?? '') || !/^[a-f0-9]{64}$/.test(runKey ?? '')) throw new Error('原标签页缺少轮次凭证');
  const response = await fetch('/functions/v1/app/api/d5/agent-diagnostic', {
    method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Run-Key': runKey },
    body: JSON.stringify({ run_id: runId }),
  });
  const { status, request_id } = await response.json();
  console.info({ http: response.status, status, request_id });
})();
```

4. **读取脱敏结论。** 原应用资源前缀是 `d5-generation/<SHA-256("campus-drill:d5:anonymous:v1:resources")>/`。在同一个私有 Storage 目录查看 `agent-diagnostics/<本次诊断 UUID>/started.json` 和 `result.json`。`started.json` 留存占用，`result.json` 留存状态、HTTP 状态、关联 ID 及已筛选的 `error.type/code/param/message`。`field_status` 区分 `absent`（上游没给）与 `omitted`（值无法安全保留）。`body_status` 另有 `empty`、`non_json`、`fields_missing`、`limit_reached`、`read_timeout`、`read_failed`、`byte_stream_unavailable`。只把这些脱敏结果带回协作记录。若仅有开始标记或结果未知，保留现场并停止，不换 UUID 补发。手动一次执行，Storage 条件创建与进程内并发锁阻止常规重复请求，平台跨实例条件写入的原子性未用真站验证。
5. **关闭并核对。** 重新发布关闭版，去掉诊断 ID 的声明并让实验与旧模型发送开关处于关闭态。确认实际域名命中新版，再使用只读方式复核绑定和台账。记录三张表及 `sent` 增量为零，Environment、Session 与模型消息的增量为零。保留原证据和新诊断记录。

`agent_ready` 表示本次创建成功且已保存部分绑定。正常流程以后可复用 Agent，再准备 Environment。`reused` 表示已有有效 Agent，本次没有创建。`rejected`、`outcome_unknown`、`binding_unavailable` 分别记录收到拒绝、结果未知或绑定操作失败。出现新 400 后按其脱敏字段另开参数修复。创建成功和复用均不关闭公网匿名剧本验收。
