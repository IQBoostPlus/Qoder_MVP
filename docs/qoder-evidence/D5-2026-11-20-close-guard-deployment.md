# D5 闭门部署与开放闸门 · 2026-11-20

本轮先在关闭态应用数据库台账迁移并部署（真实模型发送 **0 次**），再由管理员临时录入两个开关完成真实并发、预算、断流与迟到隔离复验（真实发送 **6 次**，含 1 次误发），最后重新发布恢复关闭态。历史云端验收的 10 次发送与失败结论保留，累计 16 次。写入架构、四项复验与最终关闭见 §8、§9。本文不含令牌、Cookie、签名 URL、数据库连接串或完整鉴权头。

## 1. 部署身份

| 项 | 值 |
| --- | --- |
| 页面 / 访问策略 | `https://d1-connectivity-check-xmu7lhnh7vx.qoder.zone/d5/index.html`；仍为 private，未改访问策略、未发布公网 |
| projectId / siteId | `01a1e975-1db6-7009-9e6a-650853ca2bb1` / `01a1e975-1db9-72f3-8c5f-e01f8f858c83` |
| actionId | `b4c2d8e1-6f3a-4c07-9a1e-2d5f7b9c0e13` |
| 制品校验 / 发布操作 | `01a1f8e9-96eb-7989-a390-96d23bd4d316`（artifact_verified）/ `01a1f8e9-fd35-7eae-95ac-eb897fe27b0f`（committed） |
| deploymentId | `01a1f8e9-9533-7889-9315-752bf8fdbb5e` |
| 页面 bundle | `assets/index-CohQAzkI.js`（实际域名返回的 `index.html` 引用此文件；未含 `D:/Git` 路径） |
| Function 实例（本次 diag） | `17fd7980-a42f-45ac-bbfd-1f431a6f8520` |
| 服务端开关 | Secrets 列表为空；`D5_ENABLE_QODER`、`D5_ENABLE_TEST_ROUTES` 均未配置，按代码默认关闭 |
| 数据库 | 未改表结构、未写业务表；本轮关闭态不写 Storage 台账（第二轮已完成迁移与台账切换，见 §8） |

上一版部署为 `01a1f89f-c364-7d30-9df0-9323bf65118f`（历史验收使用）。本轮部署之后，实际域名行为与工作区关闭护栏一致。

## 2. 关闭态实测

| # | 检查 | 关联标识 | 结果 |
| --- | --- | --- | --- |
| 1 | `GET /api/d5/diag` | 实例 `17fd7980…8520` | 200：`configured=false`、`real_generation_enabled=false` |
| 2 | 新 run 的 `POST /api/d5/scenario` | run `d5-close-mwoycbpl-25wr50` / req `0abb5731-378c-4508-af89-7af2eb1049e7`；`TPL-GYM-CROWD-01` | 200 `ready`：`selection=fallback`、`fallback_reason=not_configured`、`calls=0`、`shared_retry_used=false`、`upstream_state=not_sent`、`provider=null`；返回同模板预置包（标题「体育馆拥挤与通信中断 · 天健苑·体育中心」） |
| 3 | `POST /api/d5/warm` | req `20b6e03c-b348-4686-974c-89d4561d151c` | 503 `d5_generation_disabled` |
| 4 | `POST /api/d5/test/seed`（带 `x-d5-test: 1`） | req `8fbb33f2-14d2-4a62-8c2d-6f5eb4008328` | 404 `d5_test_routes_disabled` |
| 5 | 同上，不带测试头 | 同上开关 | 404 `d5_test_routes_disabled` |
| 6 | 旧结果只读 `GET /api/d5/scenario` | run `b8cd43fe-dcf4-495b-a53c-9c08bf5f5190` / req `0dae1c3c-…-ddca2ff1dba6` | 200：`selection=generated`、`provider=qoder`、`calls=1`、`upstream_state=complete`、标题「宿舍火情与积水 · 萃园 7 幢（北 7）」 |
| 7 | 旧 run 的 `GET /api/d5/stats` 前后对比 | 同上 | 均为 `calls=1`、`upstream_state=complete`，不增加发送；`final=false` 为历史落盘状态 |
| 8 | 页面「请求 AI 剧本」 | 默认模板 `TPL-NIGHT-DORM-01`（night + heavy_rain） | 徽标「预置回退 · 预置上报」，提示「生成服务未启用。已载入同模板预置剧本。本轮调用 0/4」 |
| 9 | 从该预置进入训练并提交一次操作 | 同页 | T+30 判读 U1 → 待核，seq1 `已记录 @30`；不发生任何模型发送 |
| 10 | 实际域名返回的页面制品 | `index.html` | 引用 `assets/index-CohQAzkI.js`，与本地重建产物一致 |

## 3. 证据边界

- **已证明「开关已部署」**：实际域名返回的新 bundle 与新 Function 行为一致（diag 关闭、POST 回退、warm/测试路由阻断），并记录 deploymentId 与发布操作 ID。
- **已证明「新请求走回退」**：新 run 返回同模板预置，`calls=0`、`upstream_state=not_sent`、`provider=null`。
- **「实际零发送」的证明范围**：关闭路径在代码上只读台账并组装预置，不进入 Provider 调用；响应计数为 0/未发送；本轮前后旧 run 计数不变。平台侧无可用审计：`get_function_logs` 的 requests 与 output（近 1 小时）均为空，历史同样为空。因此不能据此宣称平台层面绝对不存在任何外部请求，只能证明「按站点回执与代码路径，本轮未计数、未发起模型调用」。
- 本轮页面截图仍受 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE` 限制，凭证为 DOM 文本与网络/接口回执；未使用伪造截图。
- 未记录 Secrets 值、Cookie、签名 URL；站点 cover URL 的签名参数已省略。

## 4. 第一轮累计调用

| 类别 | 次数 |
| --- | --- |
| 本轮关闭态模型发送 | **0** |
| 历史真实模型发送（2026-11-20 云端验收） | 10 |
| 累计 | 10 |

第一轮结束开关状态：**关闭**（`D5_ENABLE_QODER` 未配置，`D5_ENABLE_TEST_ROUTES` 未配置）。后续真实模式复验与最终累计见 §9。

## 5. 当时的阻塞与后续闭环

本节保留第一轮的状态；§9 已完成真实模式复验、最终关闭与重新发布。仍开放的仅有跨实例**同时**写入的直接证据和服务端 14.5 秒超时强制触发。

1. **（当时）真实模式隔离复验未执行**。站点没有可写的开关配置入口：`get_site` 的 Secrets 为空，MCP 仅提供 Secret 删除，不提供新增/改值；`D5_ENABLE_QODER=1` 与临时的 `D5_ENABLE_TEST_ROUTES=1` 需在 Site Settings 由人工录入，值不进入对话。管理员录入后已完成复验，见 §9。
2. **写入架构修复未实施**（已由第二轮实施：迁移 `01a1f8f5…9a38`、部署 `01a1f8fa…00f8`，见 §8）。Sites Storage `upload(..., {upsert:false})` 的并发非原子已被历史样本 `d5-acc-dedup-mwovk2o0-bm8bds` 证实；改用 Sites 数据库唯一约束需要新增表，属于结构变更，须先确认 §6 的最小改动。
3. **（当时）浏览器→Sites 首段断流、超时→同模板预置、迟到结果不覆盖**无实测；现已完成发送后断流、客户端超时与迟到隔离复验，服务端 14.5 秒超时仍未强制触发（§9.3）。
4. 首个成功样本缺 Session 前缀，仍只能从既有记录查回，不得为补凭证重新发送模型请求。

## 6. 原子台账最小改动（已确认并在第二轮应用，见 §8）

### 6.1 目标

让「请求登记、预算槽位占用、终态落盘」在并发下只有一个写入者成功，消除历史样本中「失败方先写回退、成功方生成结果无法落盘」的终态不一致。

### 6.2 方案

只新增三张 D5 专用表，**不修改任何冻结业务表**。全部采用「只插入、不更新」：

- 主键冲突即“已有写入者”，由数据库唯一约束保证原子性；
- 结果与 final 也以插入定终态，先写者胜；
- Storage 仅保留 trace 证据，不再承担协调与终态。

```sql
CREATE TABLE app.d5_generation_runs (
  user_hash text NOT NULL,
  run_id text NOT NULL,
  request_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_hash, run_id)
);

CREATE TABLE app.d5_generation_slots (
  user_hash text NOT NULL,
  run_id text NOT NULL,
  slot text NOT NULL CHECK (slot IN ('scenario', 'reports', 'review', 'retry')),
  event text NOT NULL CHECK (event IN ('reserved', 'sent', 'complete')),
  session_id text,
  meta text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((event = 'sent' AND session_id IS NOT NULL) OR
         (event <> 'sent' AND session_id IS NULL)),
  PRIMARY KEY (user_hash, run_id, slot, event),
  FOREIGN KEY (user_hash, run_id) REFERENCES app.d5_generation_runs (user_hash, run_id)
);

CREATE TABLE app.d5_generation_results (
  user_hash text NOT NULL,
  run_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('initial', 'final')),
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_hash, run_id, kind),
  FOREIGN KEY (user_hash, run_id) REFERENCES app.d5_generation_runs (user_hash, run_id)
);
```

- 槽位事件为 `reserved`、`sent`、`complete` 三行；`usage`、`unresolved` 由行推导。写入层仅允许登记胜者继续，按顺序校验保留、发送登记、完成。明确用插入返回行或唯一键冲突判定胜负；未知写入结果时先读回，无法证明所有权时停止发送。
- `initial` 是唯一初始结果。`final` 仅用于把已发送且结果未知的初始结果推进为恢复终态。竞争方读已持久化结果，常规提交无覆盖路径。历史 Storage 台账只读，以便停机和迁移后继续查询既有请求。
- 访问策略：三表对 anonymous/authenticated 均为 deny，只允许服务端 Function 访问。
- 代码影响：`cloud-verify/functions/d5-ledger.mjs` 改为数据库实现；`d5-routes.mjs` 传入 `db`；`d5-service.mjs` 调用面保持不变；本地回归补数据库 mock 与双请求并发。

### 6.3 验证计划（确认并应用后）

1. 两个开关保持关闭时应用迁移、切换为数据库台账并部署。先核对旧 Storage 结果仍可读取、Function 对新表的权限，以及未就绪时 POST 回退不写表、diag 为 false。通过隔离测试确认数据库负责请求、槽位和结果的唯一写入后，再录入临时开关。
2. 临时开启真实调用与测试路由：两个相同 POST 并发，只允许一个 claim 成功；失败方得到 202/pending，随后 GET 与胜方终态一致；任何样本不得出现一方 generated、重放 fallback。
3. 最后一槽并发：仅一个发送，另一个 409；第 5 次、共享重试重占、换 request_id 均在发送前阻断；发送后失败仍计数。
4. 进程/实例重启后读回预算与终态，确认无重复发送、无回退覆盖。
5. 真实浏览器→Sites 断流与超时/迟到路径复测；结束后删除或置 `0` 两个开关，再取一次关闭证据。

### 6.4 本地 SQL 复核

修订后的候选 SQL 在隔离的本地 PostgreSQL 18.6 中应用成功。请求登记、槽位预留、发送登记和初始结果四组竞态，各使用 8 个独立连接，均仅 1 个插入返回胜者。额外槽位、非法事件、无 Session 的发送事件及非法结果种类均被约束拒绝。该检查验证数据库约束与独立连接竞争；Sites 迁移、Function 权限、事件顺序和真实发送仍需部署后复验。

### 6.5 已知残留

- claim 胜者在写终态前崩溃时，其他调用者只能保持 pending，不自动接管。本轮不引入租约/接管；需在开放记录中保留该限制，或在后续以独立租约表扩展。

## 7. 交接给 B 轨

- 公网预置版可独立推进：使用关闭态部署即可，页面会返回同模板预置并明确标记「预置回退」。
- D5 整体验收仍包含匿名访问与两名未参与开发同学的五步试用；不得以本轮私有站关闭态证据替代。
- §6.3 复验已完成并恢复关闭（§9）。再次开放时需管理员重新录入开关并发布；关闭时必须删除 Secret 后**重新发布**，否则旧实例仍保留开关。

## 8. 数据库台账迁移与关闭态部署（第二轮 · 2026-11-20）

按 §6 最小改动（只新增三张 D5 专用表、不改冻结业务表）在**两个开关均关闭**时应用迁移、切换数据库台账并重新发布。本轮模型发送 **0 次**，累计仍为 10 次。以下 ID 只保留标识，不含令牌或连接串。

### 8.1 迁移

| 项 | 值 |
| --- | --- |
| migrationId / clientMigrationId | `01a1f8f5-176e-7d86-b344-a67b36579a38` / `d5-ledger-2026-11-20-v1` |
| 应用操作 | `01a1f8f5-2413-7974-aa44-bcbb818762fb`（applied） |
| 表 | `d5_generation_runs`（PK `user_hash,run_id`）、`d5_generation_slots`（PK `user_hash,run_id,slot,event`）、`d5_generation_results`（PK `user_hash,run_id,kind`） |
| 访问策略 | 三表均 `function_backend`（authenticated 全动作），无匿名/公开访问；平台裁剪了草稿中的 CHECK/FK，唯一约束保留 |
| 目录刷新 | 操作 `01a1f8f9-60a0-7502-9d7e-c45e75a27354`（database_catalog_refreshed） |
| 部署载入 schemaRef | `sr_Uq9NfbB…2-j7A`（迁移后新读取） |

唯一写入验证：发布前由 Owner 管理通道对台账表插入一条同主键探针，第二次插入返回 `affected_rows:0` 且读回仍为一行，随后删除探针；三表当前为 0 行。平台未保留草稿中的 CHECK/FK，`slot`/`event`/`kind` 取值由 Function 代码约束；代码实际使用 `kind=result|final`（草稿 §6.2 的 `initial` 已更名）。

### 8.2 代码与部署

| 项 | 值 |
| --- | --- |
| 台账实现 | 新增 [d5-db-ledger.mjs](../../cloud-verify/functions/d5-db-ledger.mjs)：只插入不更新，主键冲突即非写入者；旧 Storage 台账改为只读回退（`readRequest`） |
| 服务切换 | [d5-service.mjs](../../cloud-verify/functions/d5-service.mjs) 统一经数据库台账；[d5-routes.mjs](../../cloud-verify/functions/d5-routes.mjs)/[routes.mjs](../../cloud-verify/functions/routes.mjs) 传入 `db`；`diag.ledger='database'` |
| actionId | `8d2b6f14-3a0e-4e57-b6a3-2c9d1e7f40ab` |
| 制品校验 / 发布操作 | `01a1f8fa-03fe-7b54-8b21-cfc0745a7b43`（artifact_verified）/ `01a1f8fa-24df-71a1-8574-893660bb078b`（committed） |
| deploymentId | `01a1f8fa-0221-786b-83a1-85f3662400f8` |
| 页面 bundle | `assets/index-CohQAzkI.js`（本轮前端未改，哈希与上一版相同；行为差异在 Function） |
| Function | `app` edge，`database_access=read_write`，`required_secret_names=[]`，`functionPublicationStatus=published` |
| Secrets | 空（两个开关仍未配置，按代码默认关闭） |
| Function 实例（本轮 diag） | `75481966-6c0a-498f-a83d-df63b17537c7` |

### 8.3 关闭态实测（真实域名，第二轮）

| # | 检查 | 关联标识 | 结果 |
| --- | --- | --- | --- |
| 1 | `GET /api/d5/diag` | 实例 `75481966…37c7` | 200：`configured=false`、`real_generation_enabled=false`、`ledger=database` |
| 2 | 新 run `POST /api/d5/scenario` | run `d5-dbclose-1795178539107` / req `f9320e3c-581c-4fe1-b8a8-e44b6669d3d7`；`TPL-NIGHT-DORM-01` | 200 `ready`：`selection=fallback`、`fallback_reason=not_configured`、`calls=0`、`shared_retry_used=false`、`upstream_state=not_sent`、`provider=null` |
| 3 | 同新 run 的 `GET /api/d5/scenario` | 同上 | 404（关闭态不落库、不产生可查询终态） |
| 4 | `POST /api/d5/warm` | req `a10bef90-f420-4e11-869c-b95288b54796` | 503 `d5_generation_disabled` |
| 5 | `POST /api/d5/test/seed`（带 `x-d5-test: 1`） | req `a64befe5-3dfd-4839-a646-95c7f5005303` | 404 `d5_test_routes_disabled` |
| 6 | 同上，不带测试头 | req `57b77071-e07b-4223-8278-24d48ee75318` | 404 `d5_test_routes_disabled` |
| 7 | 新台账三表行数（关闭态请求后） | runs / slots / results | 均 `total_count=0`：未就绪不写库 |
| 8 | 旧结果只读 `GET /api/d5/scenario` | run `b8cd43fe-dcf4-495b-a53c-9c08bf5f5190` / req `0dae1c3c-c130-45ec-a25d-ddca2ff1dba6` | 200：`selection=generated`、`provider=qoder`、`calls=1`、`upstream_state=complete`，标题「宿舍火情与积水 · 萃园 7 幢（北 7）」，10 条上报；来自只读 Storage 回退 |
| 9 | 旧 run `GET /api/d5/stats` 连续两次 | 同上 | 均 `calls=1`、`upstream_state=complete`、`final=false`，不增加发送 |
| 10 | 页面「请求 AI 剧本」 | 默认模板 `TPL-NIGHT-DORM-01`（night + heavy_rain） | 徽标「预置回退 · 预置上报」，提示「生成服务未启用。已载入同模板预置剧本。本轮调用 0/4」 |
| 11 | 从该预置进入训练并提交一次判读 | 同页 | T+30 判读 U1 → 待核，账本「已记录：待核 · 未定位 @30」；本轮调用仍 0/4 |

### 8.4 证据边界与状态

- **台账已生效的证明范围**：diag 返回 `ledger=database`；旧 run 的 GET/stats 在成功返回前会执行 `d5_generation_runs` 的 SELECT 并按空结果回退 Storage，说明部署后的 Function 具备新表读权限且查询链可用；关闭态所有写路径被开关短路，三表保持 0 行。写入路径（claim/槽位/终态）要到临时开启开关后的并发复验才能取得真实证据。
- 关闭态仍按代码路径与站点回执证明「未计数、未发起模型调用」，平台日志不足以作平台级审计（本轮 `get_function_logs` requests 近 1 小时仍为空）。
- 下一轮（需管理员人工录入两个开关）：§6.3 第 2–5 项真实并发、预算与最后槽、浏览器→Sites 断流、超时与迟到隔离；结束后删除或置 `0` 两个开关并再取关闭证据。该轮已在 §9 完成。
- 已知残留不变：claim 胜者在写终态前崩溃时其余调用者保持 pending（§6.5）。

## 9. 真实模式隔离复验与最终关闭（2026-11-20）

管理员在隔离验证入口临时录入 `D5_ENABLE_QODER=1` 与 `D5_ENABLE_TEST_ROUTES=1` 后，完成 §6.3 第 2–5 项。随后删除两个 Secret 并重新发布；本轮最终开关状态为**关闭**。真实模型发送 **6 次**（其中 1 次为误发，原因见 §9.4），累计 16 次。以下 ID 不含令牌、Cookie、签名 URL 或连接串。

### 9.1 同请求并发（第 2 项）

| 项 | 结果 |
| --- | --- |
| run / req | `d5-real-conc-1795179319392` / `144fb893-874e-412d-9e09-7ed35dfadf2a`；`TPL-NIGHT-DORM-01`（night + heavy_rain） |
| 并发结果 | 一方 `202/pending`，一方 `200/ready` 且 `generated`、`calls=1`、`provider=qoder`；胜方请求耗时 11.96 s，生成用时 8.24 s |
| 重放一致 | 同一 `run_id/request_id` 的 `GET` 连续两次返回相同终态，`selection=generated`、`calls=1`、`upstream_state=complete` |
| 台账 | 1 行 run、3 行 slot（scenario reserved/sent/complete）、1 行 result；`stats.calls=1` |
| 边界 | 两个请求由同一实例（`ba94769d…`）服务，败方登记约晚 8 s，符合数据库串行化；**跨实例同时写入未被该样本证明**，正确性由全局唯一约束而非实例隔离保证 |

### 9.2 预算与最后一槽（第 3 项）

| 项 | 结果 |
| --- | --- |
| run / req | `d5-real-budget-1795179374763` / `73a674a3-93f4-44fb-8b78-cbd8baabc13b`；`TPL-LAB-LEAK-01`（night） |
| 预置三槽 | `test/seed` 将 scenario/reports/review 标记为 `sent/complete`，`session_id=sess_seed_*`；计数 3，真实模型发送 **0** |
| 最后一槽并发 | 两路并发：一路 `409`（已占用），一路 `200/generated` 且 `calls=4`（2.1 s）；台账 retry 槽恰好 1 条真实发送，session `sess_00w2gg…` |
| 预算封顶 | 第 5 次与共享重试重占均 `409`（前置条件不满足），`calls` 保持 4，不新增发送；换 `request_id` 返回 `fallback/conflict`、`calls=0`、不发送 |
| 台账 | 该轮 12 行 slot，真实发送仅 scenario 之外的最后槽 1 次 |

### 9.3 断流、超时与迟到隔离（第 4–5 项）

| 场景 | 结果 |
| --- | --- |
| Sites→Cloud 段中断 | `d5-real-cut-1795179404222`（`TPL-GYM-CROWD-01`，comms_outage + crowd_peak）：`test/interrupt` 在 `user.message` 被受理后停止轮询，返回 `calls=1`、`upstream_state=unknown`；随后原请求 `GET` 恢复为 `generated`，生成 `result` 与 `final` 两行，`final=true`，不再发送；上游事件含已受理的 `user.message` 与 `agent.message` |
| 浏览器→Sites 首段（发送后切断） | `d5-real-b2s-1795179504502`（night + heavy_rain）：服务端 `stats` 已显示 `calls=1`、`unknown` 后，于第 8.0 s 中止浏览器请求；稍后 `GET` 恢复 `generated`、`calls=1`、`complete`，服务端在客户端断开后继续完成，无重复发送 |
| 浏览器→Sites 首段（未发送即取消） | 第 1.2 s 取消时请求尚未派发，未产生 claim/台账行，`GET` 404；说明早取消不会“凭空计数”，但不构成发送后断流证据 |
| 客户端等待超时 | 以不派发请求的挂起模拟：页面在 15 s 后显示「等待已达 15 秒。已载入同模板预置剧本。调用结果待查询」，进入预置训练，0 发送；服务端 14.5 s 慢模型超时路径**未强制触发**（三次真实生成均 <11 s） |
| 迟到结果隔离 | 迟到请求 `4457db0f-300a-4fd7-a37c-40bdc32e75b5`（`TPL-NIGHT-DORM-01`，night + heavy_rain，1 次发送）在服务端已完成；页面已用预置进入训练，未自动被迟到结果覆盖；仅当用户显式点「查询上次生成」才载入该 `generated` 结果，`stats.calls` 不变 |
| 跨实例读回 | 读取请求分别由 `ba94769d…`、`494248ad…`、`77037aea…`、`b87fb989…` 服务，`stats` 与结果一致；真实并发写入仍只观察到单实例参与 |

### 9.4 关闭与误发：Secret 删除未即时生效

- 删除两个 Secret（操作 `01a1f90c-0c11-7ca5-b915-5115a4296495`、`01a1f90c-2225-751a-8b62-2f293cc6a9d1`）后，`get_site(secrets)` 显示空列表，但运行中的实例 `77037aea…` 仍返回 `configured=true`/`real_generation_enabled=true`，warm 200、测试路由可用。
- 由此在关闭核验时误发 1 次真实生成：run `d5-close2-1795179700222` / req `cd900740-eb89-43ed-864a-ab2f741ba1b5`，session `sess_00w2gy…`，`calls=1`；随后的两次 `test/seed` 把 reports/review 补为 `sent/complete`，该轮计数被推高到 3（非 3 次模型发送）。这 1 次计入本轮真实发送与累计。
- 结论：删除 Secret 只同步元数据，不重启已部署实例；必须重新发布才能让空环境生效。

### 9.5 最终关闭部署与关闭态核验

| 项 | 值 |
| --- | --- |
| actionId | `9a71d3e5-2c48-4f0b-8e6d-517b9c2f4a83` |
| 制品校验 / 发布操作 | `01a1f90e-9f3c-738d-abff-ae2b2468b513`（artifact_verified）/ `01a1f90e-bee4-77d1-b349-b275c24fc330`（committed） |
| deploymentId | `01a1f90e-9d2d-75be-b3a7-4b804a37ba4e` |
| 页面 bundle | `assets/index-CohQAzkI.js` / `assets/index-BI1IQflS.css`（前端未改，与上一版一致） |
| Function / Secrets | `app` edge，`read_write`，`required_secret_names=[]`，`published`；Secrets 列表为空；访问策略仍为 private |
| 新实例（关闭态 diag） | `b87fb989-b846-4c83-b202-aa4778c4e31c` |

关闭态实测（实际域名，`/functions/v1/app/api/d5/*`，与页面 bundle 一致）：

| # | 检查 | 关联标识 | 结果 |
| --- | --- | --- | --- |
| 1 | `GET diag` | 实例 `b87fb989…` | 200：`configured=false`、`real_generation_enabled=false`、`ledger=database` |
| 2 | 新 run `POST scenario` | run `d5-closed-1795179987156` / req `closed-28335f02-c242-4866-a526-1f87556502f2` | 200：`selection=fallback`、`fallback_reason=not_configured`、`calls=0`、`upstream_state=not_sent`、`provider=null`、`report_source=preset` |
| 3 | 同 run `GET scenario` | 同上 | 404 `missing`（关闭态不落库） |
| 4 | 同 run `GET stats` | 同上 | 200：`calls=0`、`upstream_state=not_sent`、`result=null` |
| 5 | 另两次新 run `POST scenario` | `d5-closed-1795179996433`、`d5-closed-1795179999887` | 均回退同模板预置，`calls=0`；未写入台账 |
| 6 | `POST warm` | req `613639a6-22bf-40d6-9b7e-39351f09cf85` | 503 `d5_generation_disabled` |
| 7 | `POST test/seed`（带测试头） | req `708d3657-f2f2-4a1c-b9dd-1329e0e105bd` | 404 `d5_test_routes_disabled` |
| 8 | 台账行数（关闭态请求后） | runs / slots / results | 6 / 33 / 7，与关闭前一致；新 `d5-closed-*` 均无行 |
| 9 | 真实轮次只读 | conc / budget / cut / b2s | `stats.calls` 分别 1 / 4 / 1 / 1，`upstream_state` 均 `complete`；cut 结果仍可读回 `generated`、`provider=qoder`、`t_end=280` |
| 10 | 页面「请求 AI 剧本」 | 默认模板；为放行一次请求，将本地会话计数临时置为 2/3（仅本地额度） | 徽标「预置回退 · 预置上报」；提示「生成服务未启用。已载入同模板预置剧本。本轮调用 0/4」；计数变为 3/3，无 pending |
| 11 | 控制台与训练入口 | 同页 | 0 条 console error；进入预置训练，动作区可用 |

### 9.6 累计调用与残留

| 类别 | 次数 |
| --- | --- |
| 本轮真实模型发送 | **6**（并发 1、最后一槽 1、中断 1、发送后首段断流 1、迟到样本 1、误发 1） |
| 历史真实模型发送 | 10 |
| 累计 | **16** |

- 最终开关状态：**关闭**（Secrets 为空，重新发布后 diag 为 false）。
- `get_function_logs` 的 requests/output 仍为空，不能作平台级审计；零发送与 6 次发送均按站点回执、台账行与代码路径认定。
- 残留：① claim 胜者在写终态前崩溃时其余调用者保持 pending；② 跨实例**同时**写入仍未证明，2 路并发样本由同一实例服务；③ 服务端 14.5 s 超时未强制触发，客户端 15 s 超时以挂起模拟；④ 误发由 Secret 删除未即时生效导致，已通过重新发布闭环。
