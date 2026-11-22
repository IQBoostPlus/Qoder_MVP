# D6 整批上报与轮次恢复交接

2026-11-22。B 公开站根入口已发布 D6，旧 D5 保留在 `/d5/index.html`。B 的首次云同步 `503` 已在空库复现并修复，本地同源 Function 的首次 PUT、独立 GET 和导出复算均通过，B 公网待发布复验。A 私有站的历史云端读写与 Stage 3 部分验收另见 [D6 收尾记录](qoder-evidence/D6-2026-11-21-closeout.md)。

## B 立即联调 · 本机保存版

原 D6 源码已进入 `e504106`，B 的界面集成与部署记录已进入 `b7ab61d`。本次首次同步修复基于 `b7ab61d`，可用独立补丁合入。使用 Node 24 验证。

```powershell
npm ci
npm run check:d6
npm run typecheck:app
npm run build
npm run preview
```

普通构建使用本机保存，无需云数据库、令牌或 `VITE_D6_RUN_PATH`。选择一个预置模板，依次开始、提交判读与动作、推进、刷新恢复、继续到末轮、排序、结算、再刷新和导出。点「新开推演」后可用「独立核验轮次 JSON」复算导出。该入口只读取文件，保留历史轮次。三个预置模板都可从普通页面运行。

在桌面和 375px 各检查一次：首报可见，动作立即反馈，刷新恢复同一进度且不自动播放，返回旧节点只能回看，结束和再刷新均只读，排序及分项一致，导出能独立复算。375px 额外核对报告与指令入口可用、无横向溢出。固定用例的自动复算应保持 83 / 44 / 90 / 83。

可选模拟联调使用单独终端。PowerShell 设置 `$env:D5_SIMULATE='valid'; $env:D6_ENABLE_REPORTS='1'` 后运行 `npm run dev`。点击「请求 AI 剧本」，徽标显示「模拟生成剧本 · 模拟生成上报」，推进到首报检查实际候选文案。

## B 可选联调 · 同源云端保存版

已发布的 B 站应先按 [首次云同步修复与公网复验单](qoder-evidence/D6-2026-11-22-b-first-sync-fix.md) 更新 Function。已有迁移和静态入口直接沿用。下面是新建联调站的配置步骤。

1. 在 B 自己的站申请数据库与 Function，核对已有表。按 [D2 → D5 → D6 Sites 迁移顺序](../db/README.md#d5-与-d6-增量) 补缺。使用完整 A/B 通用 Function 时同时绑定 Storage，供历史兼容路径使用。D6 保存走 B 站自己的数据库。
2. 运行 `npm run build:sites:d6`。D6 页面在 `cloud-verify/dist/d6`，Function 源码在 `cloud-verify/functions`。现有站全量发布时先核对原入口保留情况。专用于 D6 的新站可以把 D6 子目录作为该新站的静态根，因为所有页面资产是相对路径。平台准备 Function 时生成 `_qoder/backend.mjs` 和 `_qoder/storage.mjs`，对应数据库与 Storage 绑定，客户端不携带服务端凭证。
3. Function `app` 赋予数据库 `read_write`，设 `D6_ENABLE_RUN_SYNC=1`。`D5_ENABLE_QODER`、`D6_ENABLE_REPORTS`、`D5_ENABLE_TEST_ROUTES` 保持 `0` 或缺省。使用生成的同源 `VITE_D6_RUN_PATH=/functions/v1/app/api/d6/runs`；仅联调纯本机版时使用普通构建。A 站登录态、域名和数据不用于 B 站。
4. 预置版在两种视口先完成前述走查，再点击「同步云端」，使用本机该轮凭证独立 GET，比较返回 `run` 与下载包。断网时先确认本机可导出，再联网同步。验证同内容重复 PUT 成功，旧修订、分叉流水为 409，缺失或错误密钥为 404。遇到 409 时留存本机 JSON，重新读远端版本并核对流水，不做自动合并。

同源接口请求形状如下。请求头中的密钥只从持有该轮的浏览器本机取得，交接包和导出不包含它。

```http
GET /functions/v1/app/api/d6/runs?run_id=<学员轮次ID>
X-Run-Key: <该轮的本机密钥>

PUT /functions/v1/app/api/d6/runs?run_id=<学员轮次ID>
Content-Type: application/json
X-Run-Key: <同一轮密钥>
```

PUT 的 JSON 体包含 `run`（完整导出快照）和 `expected_revision`（上一次 GET 的修订号，首次写入填 `0`）。GET 成功返回 `{ run }`，PUT 成功返回 `{ revision }`。

## 轮次契约

- [本机存储与导出](../src/run-store/local.ts) 提供 `createRun`、`saveRun`、`loadRun`、`exportRun`、`importRun` 和活动指针。版本 1 存冻结场景、采用的十条上报、地图快照、动作规则、来源、事件、查看节点、最远节点、开始/结束、速度、累计用时及评分缓存。可识别版本、损坏、不可用和版本冲突。
- [运行核验](../src/run-store/validation.ts) 核对时间、报告、地图引用、改判链、动作状态与资源、排序和评分。评分复算复用 `EnginePort.scoreRound`，动作一致性重判使用原流水前缀，无新增尝试。持续计时每 5 秒保存，写入、推进、回看、切页、结算等即时记录。刷新暂停自动播放，隐藏标签与切页暂停计时；已结束用时冻结。
- 重置启动新的学员 `run_id`，旧轮次记录保留。生成预算仍绑定 `origin.request.run_id`；同一次生成中的阶段用 `scenario` / `reports` 区分，关联同一根请求 ID。正式阶段追加时不得从学员尝试 ID 推算额度。
- 页面区分本机保存、内存状态、冲突与云端同步。云端同步由明确按钮触发，无后台队列。活动训练仍默认从同浏览器本机恢复。跨设备恢复依赖已知访问凭证的 GET，档案界面留 D7。

## 整批上报、预算和回退

[报告槽位校验](../src/scenario-generation/reports.ts) 从已验证的剧本构造可信槽位，逐条核对 ID、类型、时间、优先级、真值和判断窗。候选限定为保留事实原句的白名单表述与语气，使报告不能增减现场事实、地点或确认状态；至少一条文案须不同。当前覆盖受约束表述，真实模型下三模板文案质量仍待人工审阅。

[生成阶段](../server/report-stage.ts) 仅由剧本请求所有者执行。已成功生成的剧本可以追加整批上报，预置和剧本生成失败时直接进入预置上报。剧本与上报共用同一服务端 14.5 秒期限和浏览器 15 秒预算。只有明确的无效候选可尝试共享 `retry`，发送后状态未知照常计数并回退。失败保留当前剧本，仅替换为对应的预置 10 条上报。客户端验证完整结果后才挂载，本轮开始后没有异步换题路径。

Sites 与 Node 使用同一共享阶段和候选校验。更新 A 站时选择 `cloud-verify/dist` 作为静态根。先保全已有静态根与轮次，再运行 `npm run build:sites:d6 -- --verify-a-root`，核对根页、D2、D5、D6 及入口资源的 SHA-256。缺少旧页时该命令拒绝通过，先从 A 的已验证发布包恢复旧入口或使用平台保留式更新。Sites 真实批次须已有授权、D5 主开关打开且 `D6_ENABLE_REPORTS=1`。D5 已保存终态可在关闭态只读，不为历史记录补发一批。D1/D2 历史检查中可发送或初始化 Agent 的入口也受显式测试开关保护。

## 数据库映射与部署边界

| 表 | D6 用途 |
| --- | --- |
| 地图、模板、动作目录 | 沿用 D2 基础数据。D6 轮次另外保存地图和动作目录快照用于复算 |
| `scenarios` | 原节点及标准动作字段照存；新 `d6_bundle_json` 存规则、地图、版本和上报顺序。数据库场景键按持有者隔离，读回原逻辑场景 ID |
| `ugc_reports` | 10 条分行持久化。主键为数据库场景 ID 的长度、冒号、场景 ID、原报告 ID，可逆。事件和排序仍用 U1～U10 |
| `runs` | `d6_revision`、进度、来源、更新时间和访问凭证哈希；评分缓存仍在 `score_json` |
| `run_events` | 沿用 `(run_id,seq)` 和原载荷；冲突时保留上次提交，未提交事件可能留在表中 |
| D5 三张调用表 | 专门登记生成请求与预算，不保存学员训练事件 |

[已部署 D5 三表基线](../db/migrations/d5-generation-ledger-baseline.sql) 供新环境参考，A 站已存在。[Sites 纯 DDL 迁移](../db/migrations/d6-run-persistence-sites.sql) 已应用（`d6-run-persistence-2026-11-21-v1`，migrationId `01a1fc5a-beca-7dc9-b3c2-56db8ea75c95`）。[含事务函数的本地版](../db/migrations/d6-run-persistence.sql) 仅供本地 PostgreSQL。Function [同源入口](../cloud-verify/functions/routes.mjs) 只保存轮次密钥哈希。新版首次写入先登记修订 0，此时 GET 返回 404；事件完整后再条件更新 `d6_revision` 和 `d6_event_seq`。已提交轮次的后续事件部分失败时，上一修订照常可读。相同流水可重试补齐，复用未提交的相同序号但载荷不同返回 409。

Sites 迁移不接受自定义事务函数、RPC 或 `GRANT`，因此这不是多表物理事务。提交标记以上的事件行不会进入业务读取，但不会自动物理回滚；读取只采用已提交序号以内的事件。跨实例同时写入未在 D6 单独构造双实例复验。经批准后已应用纯 DDL，只配置 `D6_ENABLE_RUN_SYNC=1` 与同源 `VITE_D6_RUN_PATH=/functions/v1/app/api/d6/runs`；`D5_ENABLE_QODER` 与 `D6_ENABLE_REPORTS` 保持关闭。关闭真实生成与关闭保存仍可独立配置。

- A 私有验证站为 D1 connectivity check，Site `01a1e975-1db9-72f3-8c5f-e01f8f858c83`。D5 台账及 Agent 归 A。零模型阶段 action `22f83653-16af-4e9d-96a4-c8de1b1b96b5` 有部署与探针回执；Stage 3 随后另有发布尝试，最后一次已登录 `diag=false` 见 [收尾记录](qoder-evidence/D6-2026-11-21-closeout.md)。本次源码修复尚未发布。
- B 公开体验站 Site `01a1f8cc-becd-768a-8512-beef169dcc46`。D6 根入口和同源 Function `app` 已发布，12 张表已配置，Function 为 `read_write`，`D6_ENABLE_RUN_SYNC=1`。首写旧版 `503` 待 B 合入本次修复后复验。A 未修改该站部署、权限或数据。[B 发布记录](qoder-evidence/D6-2026-11-21-b-cloud-publish.md) · [首写修复](qoder-evidence/D6-2026-11-22-b-first-sync-fix.md)

## 云端验收结果（2026-11-21）

| 轮次 | 模板 | run_id | revision | 事件 | 总分（甄别/响应/覆盖/违规） | 云端读回 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `TPL-NIGHT-DORM-01` | `7d42a808-a920-4932-9550-9889b85e9807` | 137 | 11 | 61（90/75/10/100） | 与导出包全等；复算一致 |
| 2 | `TPL-LAB-LEAK-01` | `95095ef9-5908-47a8-bbd3-3142a1eb6763` | 42 | 11 | 55（100/25/14.29/100） | 与导出包全等；复算一致 |
| 3 · 排序轮 | `TPL-NIGHT-DORM-01` | `6510c384-9ae6-4787-adcf-46cf89916966` | 16 | 1（sort） | 15（0/0/0/100），排序正确 | 与导出包全等；复算一致 |

前两轮均含 `U1`～`U10`，20 个数据库上报键无碰撞，事件仍使用原上报 ID。第三轮在真实生成关闭时补交末回合排序 U4 → U7 → U8：云端 `sort` 事件 seq 1 / t_sim 300，刷新后「排序正确」，导出与云端全等，来源 `calls=0`；D5 台账仍为 6 / 7 / 33。幂等重复提交返回 200 / revision 137；旧修订号与同序号异内容均 409；缺失/错误密钥均 404；半写入停在 revision 1 / 0 事件，重试成功 revision 2；断网时保留本机并显示未同步，恢复后重新同步成功。关闭态 `diag.real_generation_enabled=false`，新请求回退 `not_configured` / `calls=0` / `not_sent`，测试路由 404、warm 503。完整标识、表格与限制见 [D6 云端验收](qoder-evidence/D6-2026-11-21-cloud-acceptance.md)；排序轮输出见 [复算日志](qoder-evidence/d6-sort-cloud-round.log)。

Stage 3 页端已看到夜宿火情的「AI 剧本 · AI 上报」，确认 2 次真实发送，结算 87 分、排序正确。原轮云端读回和导出复算待补。实验楼泄漏 15 秒回退，原请求终态与已用槽数待查，体育馆未执行。A 私有站两个生成开关已设为 `0` 且实际域名 `diag=false`，关闭版重新发布与临时变量移除待办。先保全旧轮和核对台账，再计算原 9 次上限内的剩余额度。见 [Stage 3 记录](qoder-evidence/D6-2026-11-21-cloud-acceptance.md#8-stage-3-部分执行与关闭收尾)。

## 回复 B 的九项问题

1. 未判读用原评分的 `attempt/window=null`；展示用收到时、后来判断窗口揭示，标明时刻。
2. 漏做动作统一以 `scenario.t_end` 为完成截止。
3. 判断理由取 `JudgmentWindow.reason`。
4. 对学员显示目录名称和第几条。存储保留动作 ID、seq 和拒绝码，延续原展示归一与跳转。
5. [确定性复盘摘要](../src/config/review-summary.ts) 继续作为唯一摘要。D7 把异步点评叠加到该摘要，使用既有事件引用。
6. 按上述轮次快照保存。刷新保留回看与只读语义。操作反馈即时确认，标准答案继续在结算后揭示。
7. D7 消费版本化冻结运行包、最终流水、评分与事件序号。第二案例和档案界面留后续，D6 不预写新的点评流程。
8. 两站归属见上。B 公开部署与 D5 两名同学的反馈独立记录。
9. 分区绘制层次、水印、双主题、时间线跳转继续沿用 B 实现，地图校验沿用已有 D2 数据。

[验证日志、浏览器截图与待办](qoder-evidence/D6-2026-11-21-reports-and-persistence.md)
