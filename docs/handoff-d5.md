# D5 剧本生成与回退交接

私有站 2026-11-20 的历史验收已完成真实生成和整轮推演，三次页面生成最长 10.51 秒，共记录 10 次真实发送。第二轮在开关关闭时应用 §6 最小迁移、切换为数据库台账并重新部署（actionId `8d2b6f14-3a0e-4e57-b6a3-2c9d1e7f40ab`，deploymentId `01a1f8fa-0221-786b-83a1-85f3662400f8`），核验关闭态回退与旧结果只读。随后管理员临时录入两个开关完成真实复验：同请求并发终态一致（一方 pending、一方 generated，重放一致，台账 1 run/3 slot/1 result）、最后一槽仅 1 次真实发送且第 5 次与换请求均被阻断、Sites→Cloud 中断后原请求恢复且不再发送、浏览器→Sites 发送后断流仍由服务端完成、15 秒客户端超时进入同模板预置、迟到结果不自动覆盖已开始的训练。本轮真实发送 6 次（含 1 次因 Secret 删除未即时生效导致的误发），累计 16 次。删除 Secret 后已重新发布恢复关闭态（actionId `9a71d3e5-2c48-4f0b-8e6d-517b9c2f4a83`，deploymentId `01a1f90e-9d2d-75be-b3a7-4b804a37ba4e`），实际域名 diag 为 false、新请求回退 `calls=0`、三表行数不变、真实轮次计数不变。跨实例同时写入与服务端 14.5 秒超时仍未直接证明。B 轨公网预置版和同学独立试用仍待验。[历史云端验收](qoder-evidence/D5-2026-11-20-cloud-acceptance.md) · [闭门部署、真实复验与最终关闭](qoder-evidence/D5-2026-11-20-close-guard-deployment.md)

## 运行包与页面

- [模板目录](../src/scenario-generation/templates.ts) 包含宿舍火情与积水、实验楼泄漏与人员失联、体育馆拥挤与通信中断。每个模板定义建筑及配对路段、修饰项、事件、参考动作和预置候选。失联、通信延迟等线索由节点和上报表达，路段阻断使用现有规则。
- [候选与运行包](../src/scenario-generation/bundle.ts) 接受 `start_building_id`、`road_id`、`first_report_at`、`confirmed_at`、`escalation_at`、`t_end`、`perspective`。楼栋及路段须按模板配对，时间必须落在整数范围内且满足各阶段间距。生成允许更换视角、时间和白名单中的地点组合。修饰项记录在场景并在初始节点展示。
- 构造器负责创建 `ScenarioBundle` 中的 `scenario`、`ugc_reports`、固定 `action_catalog` 和候选快照。生成与预置均由模板规则组装 10 条上报。服务端和浏览器各自按候选重建并逐字段核对完整包，拒绝篡改和额外字段，并用真实 `judgeAction` 判定参考动作序列。参考流水仅供校验。
- [正常入口](../src/views/ScenarioStart.vue) 发出已校验的完整结果，由 [App](../src/App.vue) 一次性创建带轮次 ID 的数据和引擎。新轮次重挂载，重置当前训练保留原剧本和试用次数。示例回放沿用原样例，“开始 D4 标准训练”用于按原方式独立重走 83 / 44 / 90 / 83。
- 来源分开显示为「预置剧本」「模拟生成剧本」「AI 剧本」或「预置回退」，上报始终标记「预置上报」。模拟失败显式标记模拟。生成服务不可用时，静态页面可在本地组装并开始同模板预置。

## 接口与调用用量

- `POST /api/d5/scenario` 接收 `run_id`、`request_id`、`template_id`、`modifiers`。同一请求复用原结果；并发未完成时为 `202/pending`。同一轮次换请求 ID 会回退为冲突，原任务继续保留。
- `GET /api/d5/scenario` 用相同字段查原请求，修饰项用重复的 `modifiers` 查询参数。若结果未知，可读取原 Agent Session 的历史；查询只读上游，迟来的合法结果只有用户再次查询时才能进入新训练。
- `ready` 返回完整运行包、选择方式、剧本/上报来源、提供方、回退原因、问题列表、请求关联、用时、已发计数、共享重试状态和上游状态。客户端预留 150 毫秒载入回退，15 秒用户等待覆盖请求、读取、校验和回退载入；服务端初次和可选重试共用 14.5 秒。只有收到无效候选时，才使用一次共享重试。发送后网络失败或失联仍保留计数并标为未知。
- 浏览器在同一页签会话内限三次用户生成操作，刷新保留。选择预置、读取原任务和后台重试不加此操作计数。这是本地交互额度，与云账号用量分开。
- 本地 SQLite 用唯一约束登记同轮请求及四个调用槽位，分别为 `scenario`、`reports`、`review`、`retry`。发送前原子转换占用状态，分别记录 `reserved`、`sent`、`complete`。发送前落账与外部网络递交之间发生崩溃时，按已占用处理并保留读回关联；禁止自动重新发送。只有剧本和共享重试由 D5 消费，另两槽留给 D6/D7。

## 运行与部署

Node 24。B 可执行 `npm ci`、`npm run check:d5`、`npm run build`，然后 `npm run preview`，按终端地址从普通入口试用。PowerShell 下用 `$env:D5_SIMULATE='valid'` 启动预览可走模拟生成成功；用 `'unauthorized'` 可走模拟授权失败；删除该变量则返回未启用并使用预置。模拟用量与真实 Qoder 无关。

版本管理中的服务端入口是 [server/index.ts](../server/index.ts)，命令 `npm run scenario:server`，默认在本机回环端口 8787。预览仅启用本地模拟或直接回退。真实适配器在独立服务端还需显式设置 `D5_ENABLE_QODER=1`、持久本地文件 `D5_LEDGER_PATH`（如管理员指定的 `d5-ledger.sqlite`）、`QODER_ACCESS_TOKEN`、`QODER_AGENT_ID`（形如 `agent_…`）、`QODER_ENVIRONMENT_ID`（形如 `env_…`）。可通过 `D5_PORT` 更改回环端口。部署时由受保护的同源路由连接该入口，前端可配置非保密路径 `VITE_D5_SCENARIO_PATH`。真实适配器使用 Qoder 的建 Session、发送事件、读取事件接口。[官方建会话](https://docs.qoder.com/cloud-agents/api/sessions/create) · [官方发送事件](https://docs.qoder.com/cloud-agents/api/sessions/events/send) · [官方事件列表](https://docs.qoder.com/cloud-agents/api/sessions/events/list)

SQLite 仅验证本机文件原子性。私有站已改为 Sites 数据库台账：新增三张只插入的 D5 专用表（runs/slots/results，复合主键），请求登记、槽位占用与终态各由主键冲突决定唯一写入者，不改冻结业务表；旧 Storage 记录只读回退，历史结果仍可查询。[台账实现](../cloud-verify/functions/d5-db-ledger.mjs) · [迁移与部署证据](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#8-数据库台账迁移与关闭态部署第二轮--2026-11-20)

历史实证保留：Storage `upload(..., {upsert:false})` 在两请求同键并发时可同时成功——同一 `run_id/request_id` 的并发样本中，失败方先写回退结果并占住 `result.json`，成功方的生成结果未能落盘，重放终态与胜方返回不一致；最后一槽并发则在槽位写入处成功收敛为 409。24 路并发 `/api/d5/instance` 只命中同一实例，平台日志为空，无法证明两实例并发参与。以上是改用数据库台账前的观察。数据库台账下的真实并发已在 2026-11-20 复验：一方 pending、一方 generated，重放一致，台账 1 run / 3 slot / 1 result。

Sites 的冻结版 `app.runs` 无生成元数据栏，本轮未改动它；D5 协调改用独立的三张专用表，冻结业务表保持不变。开始生成前需先登记运行行；请求、槽位与结果均只插入，主键冲突即已有写入者。开放前仍需在临时开启真实调用后验证原子预算、并发终态、断流与超时路径。当前若服务进程在保存终态前崩溃，待处理记录会保留，浏览器仍可回退，其他调用者保持 pending 而不自动接管。跨进程接管悬挂请求待云端持久化联调。

## 真实云端验收摘要（2026-11-20）

- 页面生成成功：`b8cd43fe-dcf4-495b-a53c-9c08bf5f5190`，`TPL-NIGHT-DORM-01`（night + heavy_rain），候选 N7/R-N7E/30/70/130/300，云端与浏览器校验均过，徽标「AI 剧本 · 预置上报」。整轮完成判读、A2 派队、末回合排序，总分 49，排序正确。
- 页面计时三次（真实成功）：7.61s（上界）、10.51s、4.35s，最大 <15s。
- 断流恢复：Sites→Cloud Agent 段以 `user.message` 已受理为前提中断轮询，原 `run_id/request_id` 查询 1.25s 恢复为 generated，重复查询与页面「查询上次生成」均不增加发送。
- 预算：最后一槽竞态仅 1 次发送、计数 3→4；第 5 次重放不增、共享重试重占 409、换请求 ID 冲突不增。
- 该历史轮未通过/未执行：并发同请求终态一致（非原子条件写）、跨实例并发证明、浏览器→Sites 首段断流、超时→预置与迟到结果不覆盖复测。除跨实例**同时**写入外，其余已在随后的数据库台账真实模式复验完成。
- 发布修复：bundle 曾把 `VITE_D5_SCENARIO_PATH` 变成 Windows 路径，已用禁用路径转换重建并重新发布（actionId `8ccbd5b5-a850-4921-a55e-83eacac8d08f`）。

## 闭门部署核验（2026-11-20）

- 重新发布 action `b4c2d8e1-6f3a-4c07-9a1e-2d5f7b9c0e13`，deploymentId `01a1f8e9-9533-7889-9315-752bf8fdbb5e`，页面 bundle `assets/index-CohQAzkI.js`；访问策略仍为 private。
- 实际域名检查：`diag.real_generation_enabled=false`；新 run `d5-close-mwoycbpl-25wr50`/`0abb5731…49e7` 返回 `fallback/not_configured`、`calls=0`、`upstream_state=not_sent`；`warm` 503；测试路由带/不带 `x-d5-test` 均 404；旧 run `b8cd43fe…5190` 只读返回 generated，stats 前后均 `calls=1`。
- 页面「请求 AI 剧本」挂载「预置回退 · 预置上报」（提示本轮调用 0/4），并完成一次判读（seq1 @30）。
- 零发送范围：站点回执与代码路径证明本轮未计数、未发起模型调用；平台 requests/output 日志近 1 小时为空，不能据此作平台级审计结论。
- 当时未执行的四项真实复验（同请求并发终态、预算与最后槽、浏览器→Sites 断流、超时/迟到隔离）已在管理员录入临时开关后完成，见「真实模式复验与最终关闭」及[证据 §9](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#9-真实模式隔离复验与最终关闭2026-11-20)。

## 接续修复与开放条件

- `check:d5` 包含原有 D1–D5 回归、Node 与 Sites 三模板数据一致性、并发及关闭护栏测试，以及数据库台账 mock（原子 claim、终态冲突、并发败者只读、旧 Storage 只读回退、最后槽单发送、中断恢复写失败、关闭态零写入/零出站）。云端探针改为 JavaScript 原生模块，所需 D5 Function 源码纳入 Git 可见范围。站点绑定和平台产物仍不进入交接包。[干净目录验证日志](qoder-evidence/d5-handoff-validation.log)
- 本地双请求争用回归按数据库语义断言：未取得登记或槽位的一方只读已有结果；生成端只返回实际持久化的终态；终态写入冲突、断流恢复写入失败和中断后恢复均有覆盖。旧 Storage 的并发非原子已由历史云端样本证实，现仅作只读回退。
- [Sites 生成路由](../cloud-verify/functions/d5-routes.mjs) 仅在服务端 `D5_ENABLE_QODER=1` 时允许真实调用。缺省、其他值或环境读取失败时，诊断返回 `real_generation_enabled=false` 与 `ledger=database`；新请求返回同模板预置（`not_configured`、`calls=0`）；既有结果只读；预热和测试路由关闭。测试路由另需 `D5_ENABLE_TEST_ROUTES=1`。本地回归在假凭证存在时验证了零上游请求；私有站已重新发布并核验上述关闭行为，最终关闭见[证据 §9](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#9-真实模式隔离复验与最终关闭2026-11-20)。
- 写入架构已按最小改动落地：新增三张 D5 专用表（runs/slots/results，主键冲突即唯一写入者，只插入不更新），不改冻结业务表；代码切换为数据库台账并保留旧 Storage 只读回退。迁移 `01a1f8f5-176e-7d86-b344-a67b36579a38`、部署 `01a1f8fa-0221-786b-83a1-85f3662400f8`，证据见[闭门部署核验 §8](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#8-数据库台账迁移与关闭态部署第二轮--2026-11-20)。
- 同请求终态一致、预算及去重、浏览器到 Sites 断流、15 秒内同模板回退和迟到隔离均已复验，证据见[闭门部署 §9](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#9-真实模式隔离复验与最终关闭2026-11-20)。复验时删除 Secret 未即时影响已运行实例，导致 1 次误发，已计入累计；必须重新发布才能让空 Secrets 生效，此后实际域名恢复关闭态。尚未直接证明跨实例**同时**写入（并发样本由同一实例服务）与服务端 14.5 秒超时路径；claim 胜者崩溃时其余调用者保持 pending。临时开关仍须由管理员在隔离验证入口人工录入，开放后再次关闭时同样需要重新发布。公网预置版与同学试用属于 D5 整体验收，可由 B 独立推进。首个成功样本的 Session 前缀可从已有记录查回。

## 真实模式复验与最终关闭（2026-11-20）

管理员临时录入两个开关后，在隔离验证入口完成 §6.3 第 2–5 项。完整记录见[闭门部署 §9](qoder-evidence/D5-2026-11-20-close-guard-deployment.md#9-真实模式隔离复验与最终关闭2026-11-20)。

| 项目 | 结果 |
| --- | --- |
| 同请求并发 | 一方 `202/pending`、一方 `generated` 且 `calls=1`；重放两次一致；台账 1 run / 3 slot / 1 result。两请求由同一实例服务，跨实例同时写入未证明 |
| 预算与最后一槽 | seed 三槽不发送；最后槽并发仅 1 次真实发送、计数 3→4；第 5 次、共享重试重占、换请求 ID 均在发送前阻断 |
| 断流 | Sites→Cloud 在 `user.message` 受理后中断，原请求恢复为 `generated` 并写 `final`，不再发送；浏览器→Sites 发送后第 8 秒断开，服务端继续完成，恢复后无重复发送；1.2 秒未派发取消不产生台账行 |
| 超时与迟到 | 客户端等待 15 秒进入同模板预置、0 发送（以挂起模拟）；迟到结果未自动覆盖已开始的预置训练，仅显式查询后载入；服务端 14.5 秒超时未强制触发 |
| 最终关闭 | 删除 Secret 后旧实例仍启用，造成 1 次误发（`d5-close2-1795179700222`）；重新发布 `01a1f90e-9d2d-75be-b3a7-4b804a37ba4e` 后 diag 为 false、新请求回退 `calls=0`、warm/测试路由阻断、台账 6/33/7 行不变、真实轮次 1/4/1/1 计数不变 |

本轮真实发送 6 次，累计 16 次；最终 Secrets 为空、访问策略仍为 private。

## 下一阶段

- B 走查 1440px、375px 和真机，部署供匿名访问的预置版，并记录两名未参与开发同学的五步总耗时和最慢步骤。
- 真实生成已具备复验证据但默认关闭。若要开放，需管理员再次临时录入开关并**重新发布**；结束后删除 Secret 并再次发布才能恢复关闭。重开前可补做跨实例同时写入与服务端 14.5 秒超时的直接证据。
- D6 可替换 `assembleBundle` 中模板上报的组装输入，保留 10 条上报的可见性、真值与判断窗校验，使用独立上报槽位。持久化拥有稳定轮次 ID、完整场景包、事件、真实用时和结算状态，读回后复算。
- D7 消费结算分项和事件序号，使用复盘槽位。共享重试已用即不可再次占用。
- [验收记录与证据](qoder-evidence/D5-2026-11-20-scenario-generation.md)
