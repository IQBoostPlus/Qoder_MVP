# D2 · 2026-11-18 · 云端验收

实测日期 2026-11-18。目标为已恢复私有的 `D1 connectivity check`（Site `01a1e975-1db9-72f3-8c5f-e01f8f858c83`，Project `01a1e975-1db6-7009-9e6a-650853ca2bb1`）。本记录仅保留脱敏资源前缀、SHA-256 指纹、操作 ID 与校验和；不包含 PAT、Cookie、登录链接参数、签名 URL、请求头值或原始凭证。站点保持 private，未做公网发布，未执行 Git 提交或推送。

## 结论

| 验收项 | 结果 | 依据 |
| --- | --- | --- |
| 站点只读核对（访问范围、数据库类型、发布版本、Function、Qoder 能力） | **Pass** | `access_mode=private`，`auth_integration_status=ready`，backend `ready`，能力 `database/functions/qoder/storage` |
| 八表迁移、D1 表保留、结构冻结 | **Pass** | 两次迁移 apply 均 `succeeded`；8 张业务表 + `d1_connectivity_check`；结构与候选迁移无差异 |
| 20 楼栋 + 28 路段写入与逐字段读回 | **Pass** | 452 项字段检查，0 diff，缺少/多余 ID 均为空，校验和一致 |
| 三座校门从同版本静态地图解析 | **Pass** | GATE3/GATE4/GATES 全部 resolved；引用道路数 2/1/1；未解析引用 0 |
| Agent 同任务持久复用（初始化、刷新/重进、两条消息） | **Pass** | 同一 Agent/Environment/Session 指纹；2 accepted / 2 replies |
| 新逻辑任务 Session 隔离 | **Pass** | 任务 B 复用 Agent/Environment，新建独立 Session，请求列表为空 |
| 重复提交与已完成请求重连幂等 | **Pass（顺序执行）** | 重复 msg1 与 resume 均 `replayed=true`，未新增模型请求 |
| 每轮计数观测 | **Pass（2/4）** | `round_accepted=2`，`round_cap=4`；两次顺序请求均成功 |
| 每轮 4 次上限与第 5 次请求兜底 | **Unverified** | 兜底分支已实现，预算耗尽后的请求未实测 |
| 并发多实例下的原子预算/计数/索引 | **Unverified** | 私有 Storage 可持久化与条件创建，但无原子 CAS/事务；存在 check-then-act |
| 真实断流后 pending 恢复 | **Unverified** | 仅实测已完成请求 replay；未强制制造发送中断 |
| Function 请求/输出日志 | **Unverified** | 查询窗口内日志为空；以 Function HTTP 响应和数据库/Storage 读回为准 |
| 模型配额数值 | **Unverified** | 云 API 未提供配额字段，记为 not provided |

## 1. 站点与私有发布

- 只读核对时站点仍为 private，`auth_integration_status=ready`；数据库访问模型为 `function_backend`，未改为公有，也未放宽访问策略。
- 发布动作 `0226602f-692b-48a4-bbd8-08f3e0b43783`，部署 `01a1ee3e-1d68-78c5-aa81-6924fa882c56`，publish operation `01a1ee3e-450b-7667-b730-172dd930abab`。
- `get_publish_status` 复核：`readiness=publication_completed`，`published=true`，`committed=true`，`blockers=[]`，`access_mode=private`。
- 发布校验产物：artifact SHA-256 `54245f60080730f17feceaca67d5904f819138eb8818cc07f0338c3cf9deb99a`，index SHA-256 `d0034309c2b1440f511a0a61def5af82705e7272170738726c0e201bcbf9b39b`。
- 后端能力：`database/functions/qoder/storage`；Function `app` 为 `edge`、`databaseAccess=read_write`、`preparation_status=ready`、`functionPublicationStatus=published`。
- 私有测试入口为同站 `/d2.html`；所有业务请求走同源 `/functions/v1/app/api/d2/*`，身份由服务端平台上下文解析，前端不持有 PAT。

## 2. 八表迁移与结构冻结

结构目录刷新请求 `ddbef10a-ec30-48f8-bf39-a3272651fb9f`，刷新 operation `01a1ee39-9c63-7b4c-a0c5-8d088b5a85f3`；完成后 `stale=false`，观察时间 `2026-11-18T10:35:18.492359Z`。该时间作为本次结构冻结时间；冻结后未再执行 DDL，地图数据已在冻结前写入。

| 迁移 | client id（幂等名） | migration id | apply operation | 终态 |
| --- | --- | --- | --- | --- |
| 楼栋表 | `d2-probe-buildings-lower-20261118` | `01a1ee34-7fdc-7df7-9d28-a054afa425f7` | `01a1ee34-a21f-721a-a24d-f4f7d7e880a2` | `succeeded` / `database_migration_applied` |
| 其余七表 | `d2-campus-app-20261118-v4` | `01a1ee34-f5a6-74da-9940-c7c339386ba7` | `01a1ee35-0549-77dd-8f80-e57bb29104bc` | `succeeded` / `database_migration_applied` |

实际结构：

- 业务表 8 张：`campus_buildings`、`road_segments`、`disaster_templates`、`action_catalog`、`scenarios`、`runs`、`run_events`、`ugc_reports`。
- 现有验证表 `d1_connectivity_check` 保留，5 列、2 个索引，未重建、未覆盖；验收时仍有 3 行 D1 历史记录。
- 业务索引 15 个，主键 8 个，外键 6 个，额外唯一约束 1 个 `(scenario_id, priority)`；D1 索引 2 个。
- 实际 JSON 列名与候选迁移一致，包括 `polygon_json`、`adjacency_json`、`geometry_json`、`nodes_json`、`preconditions_json`、`payload_json` 等。
- 与候选迁移的审计差异：`[]`（无差异）。未发现重建、删除、覆盖既有业务表，也未发现访问策略放宽。
- 完整列类型、可空性、默认值、主键/外键/唯一/索引与 schemaRef 见 [结构快照](D2-2026-11-18-schema-snapshot.json)；快照文件 SHA-256 `b6d6ecd7ba6d15889a4169c2d1c88a2420c698c4a4473e346f6dd9e2145f4198`，与同名 `.sha256` 一致。

## 3. 地图写入与云端逐字段读回

写入前按主键读取两张表，均为 0 行，无既有冲突。按依赖先写楼栋、再写道路，使用显式 UTC 时间戳 `2026-11-18T10:31:30Z`，全部 `is_training=1`。

| 步骤 | request/operation id | 结果 |
| --- | --- | --- |
| 20 条 `campus_buildings` | `8ac41459-e7a8-4efd-816c-8b69d3c4d57d` | `succeeded`，`affected_rows=20` |
| 28 条 `road_segments` | `ac493bff-bcb6-4a54-b56b-4970502ed768` | `succeeded`，`affected_rows=28` |

写入接口的终态以写入响应和读回为准。事后再次用 `get_operation` 查询这两个数据写入操作时返回通用 `sites_request_failed`，未据此判断写入失败，也未盲目重试。

部署后的同源 Function 对数据库与 `fixtures/campus-map.json`（`schema_version=d2-1`）逐字段比较，观察时间 `2026-11-18T10:40:51.463Z`：

```json
{
  "ok": true,
  "counts": {
    "campus_buildings": 20,
    "road_segments": 28,
    "disaster_templates": 0,
    "action_catalog": 0,
    "scenarios": 0,
    "runs": 0,
    "run_events": 0,
    "ugc_reports": 0,
    "d1_connectivity_check": 3
  },
  "buildings": {
    "expected_count": 20,
    "actual_count": 20,
    "missing_ids": [],
    "extra_ids": [],
    "diff_count": 0,
    "diffs": []
  },
  "roads": {
    "expected_count": 28,
    "actual_count": 28,
    "missing_ids": [],
    "extra_ids": [],
    "diff_count": 0,
    "diffs": []
  },
  "gates": [
    { "id": "GATE3", "resolved": true, "referenced_by_roads": 2 },
    { "id": "GATE4", "resolved": true, "referenced_by_roads": 1 },
    { "id": "GATES", "resolved": true, "referenced_by_roads": 1 }
  ],
  "unresolved_refs": [],
  "field_checks": 452,
  "checksums": {
    "expected_sha256": "b85560476c19d08063a153eea4acf3c379f61a409f518c1de1de94ee57e3ee11",
    "actual_sha256": "b85560476c19d08063a153eea4acf3c379f61a409f518c1de1de94ee57e3ee11",
    "match": true
  }
}
```

字段检查覆盖楼栋 10 项 × 20、道路 9 项 × 28，共 452 项。`floors=null` 保留；多边形与邻接 JSON 值一致；道路端点、点序、`blocked`、`hazard`、`block_reason` 与训练标记一致。JSONB 读回会出现规范化空格，`timestamptz` 读回为 `+00:00`，比较时按值处理，不作为差异。场景事件仍按方案存放于 `scenarios.nodes_json`，`run_events` 只存 `verdict/action/sort`；两张流水表本次未写入（计数 0）。静态地图文件 SHA-256 为 `cccf5b9ece69234095bb03d16e91f9215bc55d4c4199f8cccca8cc568d56fe82`。

## 4. Agent 持久复用

同源 Function 将 Agent、Environment、Session 与逻辑请求落盘到私有 Storage，路径包含已验证用户哈希、轮次和逻辑任务哈希。任务 A 为 `d2-task-a` / `R1`，任务 B 为 `d2-task-b` / `R1`；以下是脱敏资源标识。

| 资源 | 前缀 | SHA-256 指纹 | 版本/备注 |
| --- | --- | --- | --- |
| Agent | `agent_00vuzhdpje` | `6a95e9ea997f835142d90285794ab9661b3a309bfcb50ebe92536adb5e075965` | version 1，model `auto` |
| Environment | `env_00vuzhe1tcq2` | `5b0f7e1c7753f8bf4d1bb3bebdabfa08f1946dffce09681e07d8b7a08e4b6189` | 任务 A/B 共用 |
| Session A | `sess_00vuzhej377` | `1764e56d2ef1f97abb2b687e861432835ee07886e063bbb8f4a192e81246a32a` | `d2-task-a` |
| Session B | `sess_00vuzji4j29` | `17d58a3a17bdc99e748d116ffd3ac685cad5187622e567aef3fe52fc2087a2d2` | `d2-task-b` |

任务 A 绑定键 `e154a7b39a752abc`，任务 B 绑定键 `cde3f019ce4d3b56`。

| 步骤 | 实测结果 |
| --- | --- |
| 首次 init | `replayed=false`；创建 Agent 1、Environment 1、Session 1；同一绑定下 `round_creation_counts` 为 1/1/1；预算 0/4 |
| 页面刷新后重进 | 页面自动读取 state；同一 Agent/Environment/Session 三个指纹；`creation_counts` 仍为 1/1/1，预算仍 0/4，未再发 init 请求 |
| 消息 m1 | `completed`；reply `D2_MSG_1_OK`；accepted 1 / replies 1；event_count 9；服务端 E2E 2512 ms；浏览器 wall 4370 ms；`error_code=null` |
| m1 请求指纹 | `9f4ccd80d1415f0c6b6fb018369a7805567f758116f12f5dc0da665bffb17c15`；创建 `2026-11-18T10:41:05.247Z`，完成 `10:41:07.983Z` |
| 刷新后 state | 恢复同一三个资源指纹与 m1 回复；accepted_total 1 / reply_total 1 |
| 消息 m2 | `completed`；reply `D2_MSG_2_OK`；accepted 1 / replies 1；event_count 19；服务端 E2E 2500 ms；浏览器 wall 4628 ms；`error_code=null` |
| m2 请求指纹 | `6cf4932ec7a6f9ed348d09b70ac25ffdd7bd48101e3640eecc09209a83c202b4`；创建 `10:41:19.388Z`，完成 `10:41:22.083Z` |
| 两条消息后 state | 2 个请求、2 accepted、2 replies；`round_accepted=2`、`round_cap=4`；资源指纹未变 |
| 重复提交 m1 | `replayed=true`，返回存档回复 `D2_MSG_1_OK`；无新模型请求；state 仍为 accepted_total 2 / reply_total 2 |
| resume m1 | `replayed=true`，状态 `completed`；无新模型请求 |
| 新逻辑任务 B init | `replayed=false`；Agent 0 / Environment 0 / Session 1；复用同一 Agent/Environment，新 Session；`round_creation_counts.sessions=2`；预算仍 2/4 |

汇总：模型请求 2 次，预算上限 4，应用层重试 0 次，发送错误码均为 `null`。两条消息合计的服务端 E2E 为 5012 ms；从首次数据库校验 `10:40:51.463Z` 到第二条回复完成 `10:41:22.083Z` 为 30.620 s，期间包含初始化、两轮模型请求和刷新恢复；重复/恢复与新任务隔离检查随后完成。模型配额未由云 API 提供（not provided）。

## 5. 持久化与并发缺口

私有 Storage 已满足本次顺序验收：绑定、Session、请求声明和完成态在页面刷新后仍可恢复；请求路径使用 `upsert:false` 的条件创建，同一 request id 的重复提交在顺序执行下被拦截。

尚未满足严格并发协调：

- 每轮预算采用“先读 `accepted`、再发送、后写回”的 check-then-act；`accepted`、请求索引和轮次 Session 列表是读-改-写，没有原子 CAS 或事务。多个实例同时提交不同 request id 时，可能同时通过 4 次上限检查，或多个索引更新互相覆盖。
- 同一 request id 的并发竞争由条件创建做了初步围栏，竞争失败分支返回 `202 request_in_progress`；该分支未在真实并发下实测。
- Function 的用户/任务隔离路径已按用户哈希、轮次、任务哈希分层，但上述计数与索引的原子性仍需协调存储或单写者机制。

按约束未新增第九张表，也未改动八表方案。若后续要求强并发预算，需另行确认协调方案（例如平台支持的原子操作/事务或专用协调表）。

## 6. 未实测与剩余事项

- **第 5 次请求兜底**：`MAX_MODEL_REQUESTS_PER_ROUND=4` 与 `D2_FALLBACK_PRESET` 分支存在，本次只用了 2 次，未触发兜底。
- **发出后失败计数**：验证 Function 在上游接受后累加 `round_accepted`。正式业务需满足「请求发出即计数」并补验已发出但失败或结果未知的请求。
- **真实断流**：未强制制造模型请求中途断开；只在请求已完成后验证 resume/replay。`sent_pending_reply` 的恢复路径保留为 pending。
- **并发原子性**：见第 5 节；顺序幂等通过，多实例同时提交未实测。
- **配额**：云模型接口未返回可用配额/余额字段，not provided。
- **Function 日志**：查询窗口内请求与输出日志为空；未获得运行期错误日志，运行时响应与数据库/Storage 读回均正常。
- **数据写入操作复查**：两个数据写入 request id 的后续 `get_operation` 返回通用失败；写入成功由 `affected_rows` 和 452 项读回证明，未重试写入。
- 本任务未执行 Git 提交/推送，未做公网发布；站点仍为 private。

## 7. 复核入口

在私有站点登录后打开 `/d2.html`，可重复执行数据库比较、初始化、发送 m1/m2、刷新后读取 state、重复提交、resume 和新任务初始化。对应同源路由：

- `POST /functions/v1/app/api/d2/db/verify`
- `POST /functions/v1/app/api/d2/agent/init`
- `POST /functions/v1/app/api/d2/agent/send`
- `POST /functions/v1/app/api/d2/agent/resume`
- `POST /functions/v1/app/api/d2/agent/state`

Agent 路由请求体使用 `round`、`logicalTask`；`send`/`resume` 另需 `requestId`，`send` 还需 `messageId`（`m1` 或 `m2`）。复核不得复用本记录中的指纹冒充新资源，应以当前用户哈希下的新返回为准。
