# D6 云端验收 · 2026-11-21

A 私有验证站完成 D6 纯 DDL 迁移、同源轮次持久化、两轮不同模板的读写验收和一轮末回合排序验收。§1～§7 是零模型阶段记录。后续 Stage 3 获授权后部分执行，夜宿火情跑通一批真实上报，实验楼泄漏超时回退，现已恢复运行态关闭。见 §8。

## 1. 结果总表

| 项目 | 状态 | 结论 |
| --- | --- | --- |
| A 站访问策略与发布版本 | **通过** | 私有站 active；最终发布 `published=true`、`blockers=[]`；实际域名命中新部署 |
| Sites 事务函数 / RPC / 服务端角色 | **通过（能力结论：不支持）** | 迁移仅接受纯 DDL；无法安装自定义函数或 RPC；已按批准的提交标记方案实施 |
| 纯 DDL 迁移 | **通过** | `d6-run-persistence-2026-11-21-v1` 已应用；新增 D6 字段 |
| 同源 `/api/d6/runs` 部署 | **通过** | GET/PUT 实际域名可用；首次上传 503 已修复 |
| 仅启用 `D6_ENABLE_RUN_SYNC` | **通过** | 唯一 Secret；D5/D6 真实生成开关均关闭 |
| 两轮不同模板全流程 | **通过** | 夜宿火情、实验楼泄漏各一轮；开始→判读/动作→同步→刷新→继续→结算→导出 |
| 云端 GET 与导出包一致 | **通过** | `stable()` 全等；同一评分器复算总分与分项一致 |
| U1～U10、上报键与事件 ID | **通过** | 两轮各 10 条；20 个数据库上报键无碰撞；事件仍用 U1～U10 |
| 幂等重复提交 | **通过** | 同内容同修订号返回 200 / revision 137，未产生新写入 |
| 旧修订号冲突 | **通过** | 409 `CONFLICT` |
| 同序号异内容冲突 | **通过** | 409 `CONFLICT`；云端仍为 revision 137、11 事件、首条判读「真报」、总分 61 |
| 缺失 / 错误访问凭证 | **通过** | 缺失 GET、错误 64 位 GET、无密钥 PUT 均 404 `NOT_FOUND` |
| 半写入 | **通过（逻辑不可见）** | 事件写入失败返回 503，提交标记停在 revision 1 / 0 事件；重试成功 revision 2 |
| 断网同步 | **通过** | 保留本机记录，显示「云端未同步，可重试 · 本机记录已保留」 |
| 本机恢复与云端 GET 区分 | **通过** | 刷新显示「已从本机恢复」；独立 GET 200 / revision 42 / 总分 55 |
| 末回合排序云端读回 | **通过** | 新一轮 `6510c384…` 提交 U4 → U7 → U8；云端 `sort` 事件 seq 1 / t_sim 300，刷新与导出复算一致 |
| 真实模型额度与临时开关 | **未执行** | 未获显式授权；未启用任何真实模型开关 |
| 三模板真实批次人工审阅 | **部分执行** | 夜宿火情跑通真实批次；实验楼泄漏超时回退；体育馆未执行。见 §8 |
| 关闭态 `diag` | **通过** | `real_generation_enabled=false` |
| 关闭态回退探针 | **通过** | `fallback/not_configured`、`calls=0`、`upstream_state=not_sent` |
| 测试路由与 warm 关闭 | **通过** | `/api/d5/test/*` 404；`/api/d5/warm` 503 |
| 零新增模型发送 | **通过（按回执与台账）** | 第二次探针前后 D5 台账 6 / 7 / 33 行不变；平台出站日志不可见 |
| 关闭后历史轮次可读 | **通过** | 三轮云端 GET 均 200；revision 137 / 42 / 16，事件 11 / 11 / 1 |
| `build:sites:d6` / `check:d6` / `build` | **通过** | 全链 EXIT 0；固定样例 83 / 44 / 90 / 83 |
| B 公开体验站 | **未改动** | 访问策略与部署保持原状，本轮不涉及 |
| Git 工作区 | **保留未提交** | 未获提交授权 |

## 2. 站点、迁移与部署标识

| 项目 | 值 |
| --- | --- |
| 站点 / 项目 | `D1 connectivity check` / `01a1e975-1db6-7009-9e6a-650853ca2bb1` |
| Site ID | `01a1e975-1db9-72f3-8c5f-e01f8f858c83` |
| 实际域名 | `https://d1-connectivity-check-xmu7lhnh7vx.qoder.zone` |
| 访问策略 | `private`，`lifecycle=active`，`governance_status=normal` |
| 后端 | `database`、`functions`、`qoder`、`storage`；`database_access_model=function_backend` |
| Function | `app`，`edge`，`database_access=read_write`，`is_active=true` |
| Secret | 仅 `D6_ENABLE_RUN_SYNC`，`sync_state=synced` |
| 未配置的开关 | `D5_ENABLE_QODER`、`D6_ENABLE_REPORTS` |
| D6 迁移 ID / 客户端 ID | `01a1fc5a-beca-7dc9-b3c2-56db8ea75c95` / `d6-run-persistence-2026-11-21-v1` |
| 迁移应用操作 | `01a1fc5a-cb27-739b-9ed7-df5b406fd78d`（`succeeded`，`database_migration_applied`） |
| 路由修复 action | `d6676339-076c-4206-ac78-00c294d28770` |
| 最终发布 action | `22f83653-16af-4e9d-96a4-c8de1b1b96b5` |
| 发布操作 | `01a1fc69-50ec-78b5-9c2e-019ffd547b49`（`succeeded`、`committed=true`） |
| 验证操作 | `01a1fc69-32cb-7689-9ef0-96ecbfe5b6f2` |
| 发布状态 | `readiness=publication_completed`、`published=true`、`artifactReady=true`、`blockers=[]` |
| 实际页面入口 | `/d6/`，加载 `/d6/assets/index-e-ByDTli.js`（200，324142 字节，SHA-256 `607b8147d602bae6ff0387fc01bbdd2b9974a10ddaaed5e1ce40a9bbb7d9afce`） |
| 前端配置 | `VITE_D6_RUN_PATH=/functions/v1/app/api/d6/runs` |
| D5 台账基线 | `d5_generation_runs=6`、`d5_generation_results=7`、`d5_generation_slots=33` |

数据库结构读取为 12 张表；D6 复用 `scenarios`、`ugc_reports`、`runs`、`run_events`，未新建业务表。D5 三张台账表保持基线，不保存学员训练事件。

## 3. 平台能力与替代事务语义

Sites 迁移接口只接受 `CREATE TABLE app.*`、`ALTER TABLE ... ADD COLUMN`、普通 `CREATE INDEX`。自定义 PL/pgSQL 函数、触发器、`GRANT/REVOKE`、`SECURITY DEFINER` 及 `CREATE FUNCTION` 均不可用；Function 数据库 SDK 虽有 `.rpc()` 入口，但没有可安装的应用层 RPC，且无法把执行权限单独限定给服务端角色。部署因此使用**纯 DDL + 单行提交标记**：

- `runs.d6_revision` 保存已提交修订号，`runs.d6_event_seq` 保存已提交事件序号。
- 首次写入先插入 `runs` 运行头（`d6_event_seq=0`），再写 `run_events`，最后以 `UPDATE ... WHERE id=? AND d6_owner_hash=? AND d6_revision=?` 推进提交标记。
- 读取只采用提交标记以内的事件；标记以上的残留行不会进入轮次包。
- 修订冲突由条件 `UPDATE` 的行数决定；同序号异内容由 `assertRunUpdate` 在写入前拒绝。
- **限制**：这不是跨表物理事务，不提供多表原子回滚。失败时已写入的标记以上行可能留在表中，但对业务读取不可见；本轮未实现残留行清理。跨实例同时写入的竞争行为未在 D6 单独构造双实例复验。

该方案经用户选择「批准并继续（推荐）」后实施。

## 4. 关闭态核验（Stage 4）

实际域名只读 `diag`：

```json
{"configured":false,"ledger":"database","real_generation_enabled":false,"instance":"b471c9b4-4587-4995-afc2-b16fd6b6af26"}
```

两次有效回退探针（`TPL-NIGHT-DORM-01`、`TPL-LAB-LEAK-01`，新 run_id / request_id）均返回：

```json
{
  "status": "ready",
  "selection": "fallback",
  "scenario_source": "fallback",
  "report_source": "preset",
  "provider": null,
  "fallback_reason": "not_configured",
  "calls": 0,
  "shared_retry_used": false,
  "upstream_state": "not_sent"
}
```

同一域名下：`GET /api/d5/test/upstream` 返回 404 `d5_test_routes_disabled`；`POST /api/d5/warm` 返回 503 `d5_generation_disabled`。第二次探针前后 D5 三表行数保持 6 / 7 / 33，未新增生成请求、结果或槽位。平台出站日志未提供，零发送结论由开关状态、回执字段与台账不变共同支持。

关闭生成后，既有轮次仍可读：

| run_id | revision | 事件 | 总分 | GET |
| --- | --- | --- | --- | --- |
| `7d42a808-a920-4932-9550-9889b85e9807` | 137 | 11 | 61 | 200 |
| `95095ef9-5908-47a8-bbd3-3142a1eb6763` | 42 | 11 | 55 | 200 |
| `6510c384-9ae6-4787-adcf-46cf89916966` | 16 | 1（sort） | 15 | 200 |

## 5. 两轮读写与复算

两轮均通过页面完成「开始 → 判读和动作 → 同步 → 刷新恢复 → 继续 → 结算 → 导出」。第二轮在刷新后继续到结算；两轮均下载导出包，并通过独立入口读取。

| 项目 | 第一轮 | 第二轮 |
| --- | --- | --- |
| 模板 | `TPL-NIGHT-DORM-01` | `TPL-LAB-LEAK-01` |
| run_id | `7d42a808-a920-4932-9550-9889b85e9807` | `95095ef9-5908-47a8-bbd3-3142a1eb6763` |
| scenario_id | `d6-5a49930b-bdc1-4d20-b968-83e13a49f855` | `d6-ee50336b-0511-45be-a89b-d76490fa5a52` |
| revision | 137 | 42 |
| 事件数 | 11 | 11 |
| 甄别 | 90 | 100 |
| 响应 | 75 | 25 |
| 覆盖 | 10 | 14.285714285714286 |
| 违规 | 100 | 100 |
| 总分 | **61** | **55** |
| 定位 | 6/10（60%） | 10/10（100%） |
| 判读错误 | U1 | 无 |
| 首真实响应 | 105 秒 | 195 秒 |
| 末回合排序 | 未提交 | 未提交 |

复算与一致性：

- 导出 JSON 与云端 GET 经 `stable()` 比较全等。
- 使用与页面相同的 `scoreRound` 对云端包复算，总分与四个分项逐项相等。
- 两轮均包含 `U1`～`U10`；事件中的判读引用仍为原上报 ID，没有改写为数据库键。
- 数据库上报键按 `${scenario_id.length}:${scenario_id}${report.id}` 构造；两轮 20 个键互不相同，碰撞数 0。
- 前两轮排序均未提交，因此评分中 `sorting.actual=[]`；这是学员未操作，不是持久化丢失。预期参考仍为 `U4 → U7 → U8`。

### 5.1 补充排序轮

为补上前两轮未覆盖的排序持久化，在真实生成关闭时新开一轮 `TPL-NIGHT-DORM-01` 预置训练，逐回合推进到末回合，提交 U4 → U7 → U8 后结算并同步。

| 项目 | 结果 |
| --- | --- |
| run_id | `6510c384-9ae6-4787-adcf-46cf89916966` |
| revision | 16 |
| 来源 | `preset` / `report_source=preset`；`calls=0`、`upstream_state=not_sent` |
| 云端事件 | 仅 1 条 `sort`，`seq=1`、`t_sim=300` |
| 提交顺序 | `ordered_report_ids=["U4","U7","U8"]` |
| 复盘排序 | 页面显示「排序正确」，`actual` / `expected` 均为 U4 → U7 → U8 |
| 云端读回 | 独立 GET 200；刷新后显示「已从本机恢复」，复盘保持正确 |
| 导出复算 | 导出包与云端 `stable()` 全等；同一评分器复算总分 15（甄别 0 / 响应 0 / 覆盖 0 / 违规 100），排序一致 |
| 调用数 | 本机来源 `calls=0`；D5 三表仍为 6 / 7 / 33，相对上一轮验收未新增 |

该轮只验证**正确顺序的排序提交、云端保存、刷新恢复、复盘展示与导出复算**。错误顺序、重复排序提交和排序与其他事件的交错提交未在本轮单独构造。

补充复算输出见 [排序轮复算日志](d6-sort-cloud-round.log)；前两轮输出见 [两轮云端复算日志](d6-cloud-rounds.log)。

## 6. 负例、半写入与断网

### 6.1 幂等、修订冲突与同序号异内容

| 测试 | 请求 | 响应 | 写入后核对 |
| --- | --- | --- | --- |
| 幂等重复提交 | 原样 PUT，`expected_revision=137` | 200 `{"revision":137}` | revision 仍 137；未新增事件 |
| 旧修订号 | 合法下一版本，`expected_revision=136` | 409 `{"code":"CONFLICT"}` | 未写入 |
| 同序号异内容 | U1 判读由「真报」改为「待核」，同步调整评分缓存，`expected_revision=137` | 409 `{"code":"CONFLICT"}` | 云端仍 revision 137、11 事件、首条判读「真报」、总分 61 |

同序号异内容测试刻意同步修改了 `score.total=64`、`discrimination=100`、`correct_judgments=10` 与 `wrong_report_ids=[]`，使整包仍能通过 `validateRun`；路由仍以事件前缀冲突返回 409，证明拒绝来自修订/流水一致性，而不是评分缓存校验。

### 6.2 访问凭证

| 请求 | 响应 |
| --- | --- |
| 缺失 `X-Run-Key` 的 GET | 404 `{"code":"NOT_FOUND"}` |
| 错误 64 位十六进制 `X-Run-Key` 的 GET | 404 `{"code":"NOT_FOUND"}` |
| 无 `X-Run-Key` 的 PUT | 404 `{"code":"NOT_FOUND"}` |

不区分「轮次不存在」与「无权访问」，避免通过响应泄露轮次存在性。

### 6.3 半写入

使用测试轮 `test-halfwrite-20261121`，复用第一轮场景：

1. 空轮次首次 PUT，`expected_revision=0` → 200 `{"revision":1}`。
2. 第二次 PUT 增加一条含 NUL 字符的事件；PostgreSQL `jsonb` 拒绝该载荷，接口返回 503 `{"code":"CLOUD_UNAVAILABLE"}`。
3. GET 读回：revision 1、事件 0、进度仍为初始值，提交标记未推进。
4. 去掉非法字符后重试 → 200 revision 2、事件 1。

该测试证明未完成写入不会以新修订号暴露；它不是数据库多表回滚。测试行保留在库中，未计入两轮验收。

### 6.4 断网、本机恢复与云端 GET

在第二轮结束页面对 `fetch` 做受控拦截（仅拒绝 `/api/d6/runs`）：

| 步骤 | 页面状态 |
| --- | --- |
| 正常同步 | `已保存到本机 · 已同步云端` |
| 拦截后点击同步 | `已保存到本机 · 云端未同步，可重试 · 本机记录已保留` |
| 恢复 fetch 后再次同步 | `已保存到本机 · 已同步云端` |

断网期间本机记录保持 `run_id=95095ef9-5908-47a8-bbd3-3142a1eb6763`、revision 42、11 事件、`finished=true`。随后刷新页面，状态显示 `已从本机恢复`；在保持该页面的同时独立 GET 云端，返回 200、revision 42、11 事件、总分 55。两者显示不同来源，未把本机恢复误报为云端 GET 成功。

## 7. 数据量与本轮新增行

| 表 | 行数 | 说明 |
| --- | --- | --- |
| `runs` | 4 | 两轮验收 + 排序轮 + 半写入测试行 |
| `scenarios` | 3 | 三轮各自的场景 |
| `ugc_reports` | 30 | 三轮各 10 条 |
| `run_events` | 24 | 11 + 11 + 1（排序轮）+ 1（测试行） |
| `disaster_templates` | 2 | `TPL-NIGHT-DORM-01`、`TPL-LAB-LEAK-01` |
| `d5_generation_runs` | 6 | 与本轮探针前相同 |
| `d5_generation_results` | 7 | 与本轮探针前相同 |
| `d5_generation_slots` | 33 | 与本轮探针前相同 |

## 8. Stage 3 部分执行与关闭收尾

Stage 3 在获得授权后临时打开 `D5_ENABLE_QODER` 与 `D6_ENABLE_REPORTS`。三模板计划额度如下。

| 模板 | 正常发送 | 共享重试上限 | 合计上限 |
| --- | --- | --- | --- |
| `TPL-NIGHT-DORM-01` | 1 场景 + 1 批次 = 2 | +1 | 3 |
| `TPL-LAB-LEAK-01` | 2 | +1 | 3 |
| `TPL-GYM-CROWD-01` | 2 | +1 | 3 |
| **合计** | **6** | **+3** | **9** |

正常路径为每轮 1 次场景发送 + 1 次批次发送，共享同一四槽预算与 15 秒期限；只有明确的无效候选才可使用共享重试，发送后状态未知照常计数。任何额外真实发送都计入用量。D5 的历史成功次数与耗时只作基线，不替代 D6 本轮的批次与合并计时证据。

Qoder 会话的阶段回执如下。会话在完成验收证据前耗尽 Credits。

- 夜宿火情首次请求因前端路径缺前缀返回 404，报告 0 次模型发送。补正部署后，一轮真实剧本与 10 条真实上报各发 1 次，页面显示「AI 剧本 · AI 上报」，总分 87，排序 U4 → U7 → U8 正确。首次保存 409，Qoder 修正了模板行对生成动作的错误约束，发布回执 action `ec32b6fd-e8bf-46c1-b0e7-298658f9d591`。原轮次的最终云端 GET、导出复算、完整分项、逐条事实审阅及点击到可训练的精确耗时待取证。
- 实验楼泄漏在客户端 15 秒超时后进入同模板预置。上游终态与发送槽数待按原请求台账核对。确认发送数为夜宿火情 2 次，实验楼已发但结果未知的槽位按预算计入，不能假定累计正好 3 次。
- 体育馆拥挤未见执行回执。续验先读取实验楼原终态和发送台账，再按已用槽位计算剩余额度。三批均需补齐场景与上报关联、脱敏 Session、页面总耗时及 10 条事实上报审阅。
- 额度中断时，工作区站点描述文件记录 action `9107e485-e227-41f3-882f-4b2b95abe378`、deployment `01a1fd08-bf41-71b4-ab93-162a6ffc743f`。站点官方管理面板另显示 15:49 有已发布版本、访问为仅所有者。描述文件与面板时间只作为恢复线索，未把它们当作关闭版本的运行证据。
- 后续通过 Qoder CLI 站点面板将 `D5_ENABLE_QODER` 和 `D6_ENABLE_REPORTS` 都保存为 `0`，保留 `D6_ENABLE_RUN_SYNC`。用户从已登录的实际域名读回 `configured=false`、`ledger=database`、`real_generation_enabled=false`，实例 `1d231370-eb5b-4d87-9177-44abad3188d1`。平台拒绝删除 `D6_ENABLE_REPORTS`，提示仍有已发布版本引用，两个临时变量保留为 `0`。收尾过程未发送模型请求。关闭版重新发布、移除变量后的复核、关闭态 POST 回退凭证仍待补全。
- 本地已将同源生成及保存路径固化到 `npm run build:sites:d6`，从 `cloud-verify/dist` 作为发布根验包。当前工作区的根页、D2、D5 与 D6 入口均保留。`check:d6`、`build` 通过。

## 9. 凭证与隐私

本记录与日志不包含令牌、Cookie、完整鉴权头或轮次访问密钥。访问密钥只保存在浏览器本机存储；文档只记录 run_id、场景 ID、修订号、分数、上报 ID 与部署/迁移标识。`d6-cloud-rounds.log` 为两轮复算的完整输出，未写入密钥。

## 10. 剩余限制

1. Stage 3 完成一轮真实页面样本，仍需补齐夜宿火情的云端读回及凭证、实验楼原请求终态、体育馆真实轮次与三模板审阅。当前运行态已关闭，变量清理仍受发布版本引用限制。
2. Sites 不支持自定义事务函数/RPC，当前为单行提交标记语义，不是多表物理事务；标记以上残留行不会自动清理。
3. D6 跨实例同时写入未单独构造双实例复验；单行条件更新在数据库层提供冲突保护，但本轮只观察到单实例请求。
4. 零发送结论依据开关、回执与台账；平台未提供可读的模型出站日志。
5. 排序已在正确顺序的预置轮次完成云端保存、刷新恢复与导出复算；错误顺序、重复排序提交及排序与其他事件的交错提交未单独构造。
6. B 公开体验站的 D6 版本、访问策略与试用记录不在本轮范围，未改动。

## 关联

- [D6 收尾、真实发送对账与最终交付状态](D6-2026-11-21-closeout.md)
- [D6 本地实现与测试](D6-2026-11-21-reports-and-persistence.md)
- [D6 交接](../handoff-d6.md)
- [质量验证](../quality-verification.md)
- [前两轮云端复算日志](d6-cloud-rounds.log)
- [补充排序轮复算日志](d6-sort-cloud-round.log)
- [D6 同源入口](../../cloud-verify/functions/routes.mjs)
- [D6 运行仓储](../../server/run-repository.ts)
- [D6 运行路由](../../server/run-route.ts)
- [Sites 纯 DDL 迁移](../../db/migrations/d6-run-persistence-sites.sql)
