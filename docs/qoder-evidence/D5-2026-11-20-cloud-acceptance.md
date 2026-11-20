# D5 云端验收 · 2026-11-20

私有验证站真实调用 Qoder Cloud Agent，验证剧本生成、预算与去重、断流恢复和页面耗时。所有模型调用均由站点 Function 在服务端发出，凭证只从服务端环境读取，本文不含令牌、Cookie、签名 URL、完整鉴权头或数据库连接串。

## 0. 环境与凭证索引

| 项目 | 值 |
| --- | --- |
| 页面 | `https://d1-connectivity-check-xmu7lhnh7vx.qoder.zone/d5/index.html`（私有站，保留原访问策略） |
| projectId / siteId | `01a1e975-1db6-7009-9e6a-650853ca2bb1` / `01a1e975-1db9-72f3-8c5f-e01f8f858c83` |
| 本次发布 actionId | `8ccbd5b5-a850-4921-a55e-83eacac8d08f` |
| deploymentId / artifact SHA-256 | `01a1f89f-c364-7d30-9df0-9323bf65118f` / `0e354815…e4b087fe` |
| 站点描述文件 | [cloud-verify/.D1 connectivity check.qoder.site](../../cloud-verify/.D1%20connectivity%20check.qoder.site) |
| 生成服务路由 | `POST/GET /functions/v1/app/api/d5/scenario`；测试路由 `/api/d5/test/{seed,last-slot,interrupt,upstream}` 需 `x-d5-test: 1` |
| Agent / 环境 / 模型 | `agent_00w25zvv5w`（指纹 `07ee8bc6…19b53`）/ `env_00w25gavf2kn`（指纹 `817a1582…d9c7`）/ `fast` |
| 观察到的 Function 实例 | `d0d8abc6-5e52-4363-9924-fe296d8c36e2`、`1f6411c1-19ae-48c1-956a-3f12caa78dc7`（同日先后出现；并发时未同时出现） |
| 数据库 | 未改表结构、未写业务表；本轮只写 Storage 台账 `d5-generation/<userHash>/<runId>/…` |

发布前修复：页面 bundle 的 `VITE_D5_SCENARIO_PATH` 曾被 Git Bash 路径转换写成 `D:/Git/functions/…`，三次页面尝试在 1ms 内网络失败。以禁用路径转换的环境重建 `cloud-verify/dist/d5`，新 bundle `index-CohQAzkI.js` 内为 `/functions/v1/app/api/d5/scenario`，重新 prepare/publish 后页面才触达服务端。

页面截图不可用：本轮 in-app Browser 无可见视图（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），凭证以下文 DOM 文本与网络/台账记录为准，未使用伪造截图。

## 1. 真实生成进入推演并完成整轮

| 项 | 记录 |
| --- | --- |
| run_id | `b8cd43fe-dcf4-495b-a53c-9c08bf5f5190` |
| request_id | `0dae1c3c-c130-45ec-a25d-ddca2ff1dba6` |
| 模板 / 修饰项 | `TPL-NIGHT-DORM-01` / `night`、`heavy_rain` |
| 生成候选 | `N7`、`R-N7E`、首报 30、核实 70、加剧 130、结束 300、视角 `witness` |
| 预置候选（对照） | `N7`、`R-N7E`、首报 30、核实 90、加剧 140、结束 300、视角 `witness` |
| 云端 / 浏览器校验 | 云端 `validateBundle` 通过；浏览器 `validateResponse` 通过并挂载推演 |
| 返回 | HTTP 200，`selection=generated`、`provider=qoder`、`fallback_reason=null`、`calls=1`、`upstream_state=complete`、`elapsed_ms=6234` |
| 页面文本 | 徽标「AI 剧本 · 预置上报」，标题「宿舍火情与积水 · 萃园 7 幢（北 7）」 |
| Session 脱敏 | **未截取**：Session 前缀只在生成响应 `trace` 内返回，该页随后刷新，`window` 记录丢失；不影响本轮判定，列为凭证缺口 |

完整回合（同一 run，浏览器 DOM 与账本）：

| 步骤 | 结果 |
| --- | --- |
| 带时刻上报 | T+30 回合 R4 显示 U1「萃园 7 幢（北 7）。住户看到楼上似乎有烟。」`@30`，可见 1/10 |
| 判读 | U1 → 待核 · 萃园 7 幢（北 7），stamp 30，账本 seq1 |
| 场景匹配动作 | A2 派队 → N7，stamp 30，受理，seq2「已通过 · 进行中 · 预计 @90」，到 T+90 显示「已完成 @90」 |
| 末回合排序 | T+300 提交 U4 → U7 → U8，seq3；结算「排序正确」，参考 `U4 → U7 → U8` |
| 分项与总分 | 总分 **49**；甄别 10、响应 100、命中 30、违规 100；判读正确 1/10；定位 1/10 |

分类：**首次成功**（无校验重试、无回退）。

## 2. Sites 预算、去重与跨实例

### 2.1 同一请求并发

| 样本 | 结果 |
| --- | --- |
| `d5-acc-dedup-mwovk2o0-bm8bds` / `8740fbe7-4ecd-474c-a6d9-48d27387aa05` | 两个 POST 均 200：A 在 4518ms 返回 `fallback(budget)`（`elapsed_ms=1360`），B 在 6790ms 返回 `generated`（`elapsed_ms=3848`）；台账 `calls=1`。持久化终态为 A 的先写回退（重放 GET 返回 `fallback budget`），与 B 收到的不一致 |
| `d5-acc-dedup2-mwovnysg-wo5isg` / `5ace44ef-f4f9-4393-9666-893aceafe1cf` | 两个 POST 均 200 `generated`（3782ms / 4136ms），`calls=1`，持久化终态为 generated，重放一致 |

结论：发送数恒为 1，但第 1 个样本出现两个调用者都按「新请求」继续（`upsert:false` 同时成功），失败者先写回退并占住 `result.json`，成功者的生成结果未能落盘。并发去重终态一致性**失败**，说明所依赖的条件创建在当前后端不是可靠原子操作。

### 2.2 最后一槽竞态

前置构造（测试路由，非业务调用）：`POST /api/d5/test/seed` 以 `x-d5-test: 1` 登记同一 `run_id` 并把 `scenario`、`reports`、`review` 三槽置为 `sent+complete`，返回 `usage.calls=3`、`shared_retry_used=false`。

| 项 | 记录 |
| --- | --- |
| run_id / request_id | `d5-acc-lastslot-mwovkq2k-1tk6j1` / `181d26e7-7e83-43cf-b72b-5c53cf609ea0` |
| 并发 | 两个 `POST /api/d5/test/last-slot`（同 body）同时发出 |
| 结果 | B 于 8509ms 返回 **409 taken**、`calls=4`；A 于 11360ms 返回 200，`slot=retry`，Session 前缀 `sess_00w26sowzdo`，模型候选未通过校验 → `fallback(invalid_candidate)`，`elapsed_ms=3578` |
| 终态 | `calls=4`、`shared_retry_used=true`、`upstream_state=complete`；仅 1 次真实发送 |

发送后校验失败仍保留计数，符合 Q5。

### 2.3 第 5 次请求与共享重试

同一耗尽轮（`calls=4`）：

- 同请求重放：200 `ready`，返回原终态（`invalid_candidate`），`calls=4`，不发送、不增加。
- 再次 `last-slot`：409 `precondition`（`usage.calls=4`），共享重试不可重新分配。
- 同 run 换 `request_id`：`fallback(conflict)`，不发送；随后 stats 仍 `calls=4`。

D5 场景阶段只循环 `scenario`、`retry` 两槽，代码上限 2 次发送；本轮所有生成样本实际各 1 次。

### 2.4 跨实例证据

- 同日不同请求先后看到实例 `d0d8abc6…` 与 `1f6411c1…`，说明站点会跨实例调度。
- 24 路并发 `GET /api/d5/instance`：24 个不同 `request_id`，`uniqueInstances=["d0d8abc6-5e52-4363-9924-fe296d8c36e2"]`。
- `get_function_logs`（requests 1h、output 关键词 d5）均为空，无执行实例 ID 可读。

结论：**无法证明两个实例同时参与处理**；该项未执行通过，缺口为平台日志不可读且并发命中同一实例。真实模式继续按平台能力结论收紧，不宣称跨实例原子预算。

## 3. 真实断流与原请求恢复

| 项 | 记录 |
| --- | --- |
| run_id / request_id | `d5-acc-interrupt-mwovmk4z-jvfzoj` / `a82a0d03-1824-4719-b2bb-33c7ad693253` |
| 模板 | `TPL-GYM-CROWD-01`（`comms_outage`、`crowd_peak`） |
| 中断证据 | `trace.accepted=true`，`accepted_event_types=["user.message"]`，Session 前缀 `sess_00w26x104ge`（指纹 `b95bd7b1…5590f6`），`interrupted_segment="sites_to_cloud_agent"`，中断时刻 `2026-11-20T11:09:18.856Z` |
| 中断后 | `calls=1`、`provider=qoder`、`upstream_state=unknown`、`fallback_reason=network` |
| 恢复前 stats | `calls=1`、`unknown`、`final=false` |
| `GET /api/d5/scenario` 原 id | 1254ms 返回 200：`selection=generated`、`fallback_reason=null`、`calls=1`、`complete`，标题「体育馆拥挤与通信中断 · 天健苑·体育中心」 |
| 重复查询 | 886ms 返回同一终态，`calls=1`，不新增发送 |
| 重复中断 | 409 `exists`，未新建请求 |
| 页面「查询上次生成」 | 用原 `run_id/request_id/template/modifiers` 发 GET；693ms 200，736ms 挂载，徽标「AI 剧本 · 预置上报」，pending 清空，本页计数仍 3/3 |

分段：浏览器→Sites 段本轮未做真实中断，只验证了 Sites→Cloud Agent 段；记为未执行。超时进入同模板预置与迟到结果不覆盖已开始训练，本轮未在正确的提示发送路径上复测（历史 `d5-probe-20261120-002` 仍是 `timeout`、`calls=1`、`unknown`、未终结，可作为后续复测样本），记为未执行。

## 4. 真实生成计时

页面时钟：点击「请求 AI 剧本」到推演横幅挂载；服务端用时取响应 `result.elapsed_ms`。三次均为真实成功（`selection=generated`、`provider=qoder`、无回退、`calls=1`）。

| # | run_id | 点击→HTTP 200 | 点击→横幅挂载 | 服务端 elapsed_ms | 发送数 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `b8cd43fe-dcf4-495b-a53c-9c08bf5f5190` | 7192ms | ≤7613ms（轮询上界） | 6234 | 1 | 成功，进入推演并完成整轮 |
| 2 | `0481db76-2700-4504-802d-c61a99c3972b` | 10485ms | 10508ms（含 500ms 脚本前置延迟） | 7022 | 1 | 成功 |
| 3 | `9e4bb170-43f6-49fc-bc8c-81645b0c5c19` | 4335ms | 4347ms | 3392 | 1 | 成功 |

最大实测 **10508ms（10.51s）**，去前置延迟约 10.01s，均 <15s。候选各次：run2 `N7/R-N7-N1/20/70/130/300`，run3 `N7/R-N7E/30/65/125/260`。

服务端分段（同模型 fast，取自 `d5-acc-dedup2` 的 trace）：登记 19.082Z → 占槽 19.253Z → 发提示 19.440Z → 回复 22.592Z → 校验并落账 3782ms。即 Session 创建约 187ms，模型回复约 3.15s，校验+保存约 0.6s。

## 5. 累计调用与结论

| 类别 | 次数 |
| --- | --- |
| 页面真实生成（3 次计时/训练） | 3 |
| 并发去重样本 | 2 |
| 最后一槽竞态（真实发送） | 1 |
| 断流样本（真实发送） | 1 |
| 验收前真实探针（auto 超时 1、超时迟到 1、fast 成功 1） | 3 |
| 合计真实模型发送 | **10** |

发布与变更：站点产物重新发布（actionId `8ccbd5b5…`）；Function 代码沿用已部署的提示发送修复与 fast 绑定。数据库表结构未变，未写业务表；新增仅为 Storage 台账目录。未提交、未推送、未发布公开版本。

## 6. 验收项结论

| 验收项 | 状态 | 环境与脱敏关联标识 | 发送数与计数前后 | 耗时或终态 | 凭证与剩余问题 |
| --- | --- | --- | --- | --- | --- |
| 真实生成进入推演（页面） | 通过 | run `b8cd43fe…5190` / req `0dae1c3c…dba6` / TPL-NIGHT-DORM-01 | 1 次；台账 0→1 | 200，generated，complete，6.2s | Session 前缀未截取；候选与预置对比见 §1 |
| 完整回合与实时评分 | 通过 | 同上；seq1 判读、seq2 A2、seq3 排序 | 不增加 | 总分 49；分项 10/100/30/100；排序正确 | 截图不可用，DOM 账本为证 |
| 同请求并发：单次发送 | 通过 | dedup 两轮 | 各 calls=1 | 均 200 | — |
| 同请求并发：终态一致 | 失败 | `d5-acc-dedup-mwovk2o0-bm8bds` | 1 次；A 先写回退 | 重放返回 budget 回退，与成功方 generated 不一致 | `upsert:false` 并发下双新建；需平台条件写或串行化 |
| 最后一槽竞态 | 通过 | `d5-acc-lastslot-mwovkq2k-1tk6j1`；seed 三槽后并发 | 1 次；3→4 | 409 taken + 200（校验失败回退） | 前置由测试 seed 构造；获胜候选无效 |
| 第 5 次与共享重试 | 通过 | 同 run | 0 次；保持 4 | 重放 200、reclaim 409、换 id 冲突 | — |
| 场景阶段 ≤2 次发送 | 通过 | 代码槽位 + 全部样本 | 实际各 1 | — | — |
| 跨实例并发参与 | 未执行 | 实例 `d0d8abc6…` / `1f6411c1…` | — | 24 并发仅 1 个实例 ID；日志为空 | 无平台执行 ID/日志，无法证明 |
| Sites→Cloud 断流 | 通过 | `d5-acc-interrupt-mwovmk4z-jvfzoj`；会话 `sess_00w26x104ge` | 1 次；unknown | accepted user.message；中断段已记录 | 仅验证第二段 |
| 浏览器→Sites 断流 | 未执行 | — | — | — | 未在允许环境内真实切断首段 |
| 原请求查询恢复 | 通过 | 原 run/request；页面「查询上次生成」 | 1 次，前后均为 1 | 1254ms/886ms 同一终态；页面 736ms 挂载 | 迟到结果与超时预置覆盖未复测 |
| 超时→同模板预置 + 迟到不覆盖 | 未执行 | 历史 `d5-probe-20261120-002` | 1 次；timeout、unknown | 未终结 | 待后续页面复测 |
| 三次真实耗时 <15s | 通过 | §4 三个 run | 各 1 次 | 最大 10.51s（约 10.01s 去前置） | 第 1 次挂载为上界 |

保持真实模式：**不开启**。阻塞点为并发条件写非原子、跨实例并发无法证明、首段断流与超时路径未实测。

## 收尾状态补注

上文「保持真实模式：不开启」记录的是验收后的上线决定。该次记录没有验证已部署 Function 阻断新的模型发送。后续工作区已加默认关闭护栏并通过本地回归，且已重新发布到私有站：实际域名核验为新请求 `not_configured`/`calls=0`、warm 与测试路由阻断、旧结果只读，本轮模型发送 0 次。平台日志为空，零发送仅按站点回执与代码路径证明。[闭门部署核验](D5-2026-11-20-close-guard-deployment.md) · [交接与开放条件](../handoff-d5.md#接续修复与开放条件)
