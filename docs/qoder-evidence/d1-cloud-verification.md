# D1 云端连通性验证

日期：2026-11-17　负责人：A
授权范围：用户确认「允许站点 + Qoder 后端」，仅创建临时验证站，访问策略保持 private。未发布任何公开页面。

临时站信息：`d1-connectivity-check-xmu7lhnh7vx.qoder.zone`，Site `01a1e975-1db9-72f3-8c5f-e01f8f858c83`，Project `01a1e975-1db6-7009-9e6a-650853ca2bb1`。测试站与 D2 正式站点分离，不影响正式契约。

## 结论

| 验证项 | 结果 | 实测依据 | 限制 |
| --- | --- | --- | --- |
| Sites 建表 | **通过** | 受限迁移 `d1-connectivity-001` 校验为 `validated`，应用后返回 `database_migration_applied`；`get_database_schema` 显示 `d1_connectivity_check` 5 列、2 索引 | 只建 1 张验证表，不是八表正式 DDL |
| Sites 数据写入（管理端） | **通过** | `insert_database_rows` 返回 `state=succeeded, affected_rows=1` | 写入必须显式提供 `created_at`，见下文「限制」 |
| Sites 数据回读（管理端） | **通过** | `query_database_rows` 按 `id` 精确返回同一条记录，字段值与写入一致 | 仅管理端读 |
| Function 部署 | **通过** | `get_site(include:[functions])`：`app`、runtime `edge`、`is_active=true`、`database_access=read_write`、`functionPublicationStatus=published` | 部署状态本身不等于请求执行 |
| Function 内数据库读写 | **通过** | 经私有站点页面调用 `POST /api/d1/db`，Function 内完成插入并按 `id` 回读；返回 `ok=true`、`run_id` 一致、`is_training=1` | 仅验证单表往返，不是八表正式读写 |
| Cloud Agent 调用 | **通过** | 经私有站点页面调用 `POST /api/d1/agent`：browser → Sites Function → Cloud Agents，返回 `ok=true`、`accepted=true`、`reply="D1_OK"`、`event_count=10`，session `sess_00vrq5x113u2o77ja5op` | 仅固定提示词的连通性检查，不是 D2 业务对话 |

**D1 判定**：建表、Function 内读写与 Cloud Agent 真实调用均按「通过」记录。Cloud Agent 证据仅覆盖一次固定提示词 `D1_OK` 的连通性对话，不能替代 D2 的剧本生成、上报或复盘业务验收。

## 1. Sites 建表

1. 新建临时站草稿并取得 Project/Site ID，保持未公开。
2. `ensure_backend` 申请 `database + functions + qoder`，`databaseAccessModel=function_backend`。操作步骤依次为 `provision_backend`、`initialize_database`、`issue_qoder_pat`、`sync_secret`，全部 `task_succeeded`。
3. `get_site(include:[backend])`：`backend.status=ready`，`capabilities` 含 `database/functions/qoder/storage`。
4. 创建迁移 `d1-connectivity-001`：

```sql
CREATE TABLE app.d1_connectivity_check (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  note text NOT NULL,
  is_training integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX d1_connectivity_check_run_idx ON app.d1_connectivity_check (run_id);
```

5. 迁移状态 `validated`；应用返回 `database_migration_applied`。
6. 结构回读：表 `d1_connectivity_check`，`column_count=5`，`index_count=2`。

## 2. Sites 数据读写

写入（管理端，显式提供全部列）：

```
state=succeeded
affected_rows=1
```

回读（按 `id=d1-row-20261117-01`）：

```
id          = d1-row-20261117-01
run_id      = d1-cloud-20261117-01
note        = D1 cloud read/write check
is_training = 1
created_at  = 2026-11-17T12:26:00+00:00
```

写入与回读值逐项一致，`is_training` 固定为 1。

**限制与处理**：管理端首次写入只提供 `id/run_id/note/is_training`，返回 `sites_request_failed`；补上 `created_at` 后成功。说明管理端插入不能依赖列默认值。

**Function 内运行时复核**：在私有站点页面点击「Run DB read/write check」，请求经站点网关进入 Function，Function 使用注入的数据库客户端完成插入与按 `id` 回读，返回：

```json
{
  "ok": true,
  "id": "bcb3eba4-1651-4e30-91ca-6a13f8680153",
  "run_id": "d1-cloud-1794919554841",
  "is_training": 1,
  "created_at": "2026-11-17T12:45:54.845553+00:00"
}
```

`created_at` 由 Function 路径成功生成，`is_training` 默认为 1，`run_id` 与写入值一致。截图见 [`d1-function-db-success.png`](d1-function-db-success.png)。

## 3. Cloud Agent

准备：

- `qoder` 能力就绪，操作记录含 `issue_qoder_pat.task_succeeded` 与 `sync_secret.task_succeeded`；未读取、未打印、未保存任何令牌。
- Function 已发布：`app`、`edge`、`read_write`、`is_active=true`。
- 验证 Function 内含三段受控请求：模型列表 → Agent/Environment/Session → 发送固定提示并轮询回复。代码仅返回会话 ID、事件数与最终文本，不返回上游原始载荷。

首次尝试（12:24 左右）因浏览器无 Qoder 会话，被私有站点网关重定向到登录页：

```
HTTP/1.1 401 Unauthorized
x-qoder-error: sites_gateway_login_required
{"code":"sites_gateway_login_required","message":"login is required"}
```

用户完成授权后，12:44 左右在已登录的 Qoder 浏览器会话中重新打开临时站，页面直接加载。点击「Run Cloud Agent check」，请求按 `browser → Sites Function → Cloud Agents` 执行，返回：

```json
{
  "ok": true,
  "agent_id": "agent_00vrq5wx7ry0wi6plzaf",
  "environment_id": "env_00vrq5wyls3y993hw20i",
  "session_id": "sess_00vrq5x113u2o77ja5op",
  "event_count": 10,
  "reply": "D1_OK",
  "accepted": true
}
```

判定：**通过**。`accepted=true` 表示消息已被接受，`reply="D1_OK"` 是轮询历史事件后取得的最终文本，二者同时满足才记为连通。全程未输入、未索取、未读取任何账号、PAT 或 Secret；`QODER_PAT` 仅存在于 Function 运行时。

**重复调用限制**：为补结果截图，12:47 再次点击同一按钮，Function 返回：

```json
{
  "error": "internal_error",
  "request_id": "81815d02-66ef-4f97-9723-2db12373300e"
}
```

第二次未取得 Cloud Agents 返回码，Function 未向页面透出上游细节。因此 Agent 结果截图未采集，本条目以首次页面返回文本为证据。重试失败不改变首次调用已成功的事实，但说明该一次性验证端点不能假定可重复执行；D2 不得每次请求都新建 Agent/Environment/Session，应持久化并复用已建资源。

## 4. 对 D2 的直接影响

- 数据库：Function 内写入、默认 `created_at`、`is_training=1` 与按 `id` 回读均已实测通过；D2 可继续用本地 JSON 保证 B 不被阻塞，再在正式站做八表迁移与业务读写。
- Agent：`browser → Function → Cloud Agents` 路径已打通，但不能把固定提示词 `D1_OK` 当成业务验收。D2 需持久化 Agent/Environment/Session 绑定并复用，禁止每次请求新建资源；剧本生成、上报与复盘仍保留预置数据兜底，直到完成一次真实业务对话。
- 重复性：同一按钮第二次调用返回 `internal_error`，D2 必须把资源创建与消息发送拆成可恢复步骤，记录幂等键与 Session ID，不重放未知结果。
- 临时站保留为 private，便于后续复测；是否删除由用户决定。

## 5. 凭证索引

- 本地契约与样例：[`d1-local-validation.log`](d1-local-validation.log)
- Function 内数据库读写结果：[`d1-function-db-success.png`](d1-function-db-success.png)
- 本文：建表、迁移、管理端写入/回读、Function 内读写、Cloud Agent 首次成功与重试失败
- 未留存：PAT、Secret、登录链接中的 transaction、封面签名 URL 等敏感字段
