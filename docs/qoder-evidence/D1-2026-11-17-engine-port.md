# D1 · 2026-11-17 · 引擎只读接口与跨轨审计

| 项 | 内容 |
| --- | --- |
| 责任人 | A |
| 轨道 | 引擎侧 |
| 关联功能 | F1 地图、F4/F5 可见性与回放、F8 评分接口边界 |
| 状态 | 已完成（静态接入）；B 页面与 D4 实时引擎待验 |

## 1. 想完成什么

在不改原类型、两份 fixture、DDL 与原校验器的前提下，交付 Node 与浏览器都能调用的只读接口：地图几何派生、上报可见性与判断窗、按序号/模拟时刻回放、道路积水与正式封闭、静态评分和路径空态。新增一条可复跑命令，把 D1-v2 的验收表变成断言，并给 B 一份可直接接入的交接说明。

本轮只验证**静态接入**，不交付 D4 实时评分器，也不提前实现 D2 寻路。

## 2. 在 Qoder 中做了什么

- 阅读 `prompt/D1-v2.md`、原交接说明、契约、两份 fixture、DDL、原校验器、需求 §2/§6/§7.3、质量验证 CD-05 和云端凭证。
- 新增 [`src/fixture-port.ts`](../../src/fixture-port.ts)：纯函数，不调用 Node 文件 API；数据全部由参数传入。
  - `buildMapView`：校验地图引用，派生路口位置、路段折线长度（px）、bounds 与 viewBox。
  - `visibleReportsAt` / `windowAt`：可见性与左闭右开判断窗。
  - `replayTo`：按 `seq` / `t_sim` 截断，还原场景事件、最后判定、动作、排序、资源占用与道路状态。
  - `getScore`：只对完整匹配的基线流水返回 `expected_scores`。
  - `getRoute`：静态模式返回 `null`；D2 的 `RouteResult` 预留 `ready` / `unreachable`。
  - 导出 `PRECISION_NOTICE`、`ROUTE_PENDING_TEXT`、`ROUTE_UNREACHABLE_TEXT`、`SCORE_PENDING_TEXT`。
- 新增 [`scripts/validate-d1-v2.ts`](../../scripts/validate-d1-v2.ts)，覆盖 D1-v2 §2 全部检查；`package.json` 增加 `check:d1-v2`。
- 更新 [`docs/handoff-d1.md`](../handoff-d1.md)（含 A/B 接口约定原文与接口用法）、[`README.md`](../../README.md) 与凭证索引。
- 未新增依赖，未修改 Git 配置，未提交或推送，未重发云请求，未改变私有站访问策略。

## 3. 如何验证

### 3.1 命令与完整输出

```bash
$ npm run check:d1-v2
```

关键输出：

```text
D1 canonical fixture validation PASSED
buildings=8 junctions=1 roads=8 reports=10 actions=6 runs=3
run-jia-1x [甲] 甄别=80 响应=100 命中=80 违规=70 总分=83 | 响应 45s, 违规 2 次, 缺项 1
run-yi-1x [乙] 甄别=60 响应=0 命中=50 违规=55 总分=44 | 响应 250s, 违规 3 次, 缺项 4
run-jia-plus-a4 [甲补做A4] 甄别=80 响应=100 命中=100 违规=70 总分=90 | 响应 45s, 违规 2 次, 缺项 0
clock_checks: 1× = 45s, 4× = 45s (模拟时刻 30 → 75 固定)
quality cases: SC-03 / SC-03b / SC-04 / SC-05 / SC-07 / SC-08 通过
map: 三投影深度相等；GATE3=(500,520)；viewBox=40 40 880 560；8 条路段长度>0；三点折线=10；平移/改名由输入决定
visibility: t=80 U1/U3/U2/U4/U5；t=300=10；U1 在 30/90/100 的窗口正确
replay: seq20=5 accepted/4 rejected/5 占用；U1 改判指向 seq2；t=140/164/165 封路状态正确
rejections: 甲 CN1×2/N7×2、违规 [14,20]；乙 A4×3、违规 [9,14,15]
score: 83；改动/删减/新增/重排/未知 run 均 null；1×/4× 模拟时刻一致且响应 45s
route: 静态 null + 空态文案；输入未被修改；专名/坐标/固定 viewBox 扫描通过；README 精度文案一致
D1-v2 fixture port validation PASSED
A 接口已测，B 页面待测（无页面，不以字符串存在替代 UI 验收）
```

完整命令与输出保存在同目录 [`d1-v2-local-validation.log`](d1-v2-local-validation.log)。未截图原因：本轮为纯 CLI 与纯函数验证，没有可截取的页面；Qoder 对话截图需用户补拍。

### 3.2 逐项验收

| 检查 | 实际结果 |
| --- | --- |
| 原基线与类型 | `tsc --noEmit` 通过，覆盖新增代码；`noUncheckedIndexedAccess` 保持开启；三份基线仍为 83 / 44 / 90 |
| 地图来源与几何 | `canonical-run.json` 与 `buildings.json` 的 `buildings/junctions/road_segments` 深度相等；`GATE3` 派生为 (500,520)；viewBox 覆盖 x[60,900]、y[60,580]；8 条路段长度均 >0 |
| 可替换输入 | 三点折线按段求和为 10；平移后长度仍为 10，路口随新末点变为 (106,-42)，viewBox 同步平移；改名不影响结果 |
| 地图错误 | 孤立路口报 `MAP_JUNCTION_UNREFERENCED/J-ISOLATED`；单点折线报 `MAP_INVALID_GEOMETRY`；同一路口端点矛盾报 `MAP_ENDPOINT_MISMATCH/GATE3` |
| 可见性与判断窗 | t=80 依次为 U1/U3/U2/U4/U5，排除 U6；t=300 共 10 条；U1 在 30/89 为待核，90/100 为真报 |
| 甲流水 | seq20：5 accepted、4 rejected、5 条占用；U1 最新改判 seq7 指向首判 seq2；A6 N7 的 `attempt` 为 1/2/3 |
| 道路状态 | t=140 `R-N7E` 积水且未封闭；t=164 仍未封闭；t=165 由 seq17 的 A5 正式封闭；封路组 140 占用、165 释放 |
| 拒绝与违规 | 甲 seq13/14 CN1 `TARGET_NOT_APPLICABLE`，seq19/20 N7 `STATUS_CONFLICT`，计罚 `[14,20]`；乙 A4 seq13/14/15 `PRECONDITION_NOT_MET`，计罚 `[9,14,15]` |
| 动作目录 | A4 的 `requires_completed_action` 指向 A3；A6 含 `requires_disaster_annotation` 与 `not_powered_off` |
| 静态得分 | `getScore('run-jia-1x')` 为 83；改动、删减、新增、重排事件与未知 run 均返回 `null`；空流水返回 `null` |
| 倍速 | 1×/4× 复用同一流水，模拟时刻序列相等；两份 `clock_checks` 响应均为 45 秒；不存在 `run-jia-4x` |
| 路径与硬编码 | `getRoute` 返回 `null`，`RouteQuery` 预留当前 `road_segments` 供 D2 使用；实现内无 fixture 专名、样例坐标或固定 viewBox；只读调用前后 fixture JSON 完全一致；README 含统一精度声明 |

### 3.3 云端边界（引用既有结果，本轮未重发）

- 依据 [`d1-cloud-verification.md`](d1-cloud-verification.md)（2026-11-17）：Sites 建表、管理端写入/回读、Function 内数据库读写、一次 `browser → Function → Cloud Agents` 固定提示 `D1_OK` 均通过。
- 私有站未登录访问曾返回 `401 / sites_gateway_login_required`；同一 Agent 检查重复调用返回 `internal_error`，上游原因未证实。
- 本轮没有重发云请求，也没有更改站点可见性；临时站仍为 private。
- D2 交 A：持久化并复用 Agent/Environment/Session 绑定，拆开资源创建与消息发送，保留预置数据入口。
- D5 交 B：首次公开部署后，用无痕未登录会话与手机实测首页、核心操作和接口，记录 HTTP 结果与截图；私有站结果不能替代。
- D6 双轨联调：页面必须区分引擎结果、标准样例与故障回退，模拟服务不可用时仍能完成整轮。

## 4. 结论与后续

- **结论**：D1-v2 的静态只读接口与验收断言已完成，原 D1 基线未被破坏。B 可以 import `src/fixture-port.ts` 或 `createFixturePort(fixture)` 接入，不需要复制寻路、判分或违规统计。
- **基线核对**：审计给出的 83/44/90、违规序号、GATE3 坐标与 t=140/164/165 道路状态均与 fixture 和实际输出一致，未发现数字不符，因此没有待写的最小复现。
- **边界**：`getScore` 只认完整基线流水，`getRoute` 固定 `null`；这不是 D4 实时评分器，也不是 D2 寻路实现。
- **未决**：B 页面尚未接入，地图页脚 CD-05、375px、道路图例、空态文案与键盘操作都需 B 实测；D4 的一正一反临场改分仍需实时引擎验证。
- **后续**：D2 路径与 20 栋、D3 规则引擎、D4 实时评分、D5 公网与用户实测、D6 双轨联调，按 README 排期推进。

## 5. 五项跨轨问题处理记录

以下保留问题原意、A 的建议与依据、B 需确认内容、负责人与检查点。D1-v2 只完成兼容工作，不替 B 签字。

### 5.1 需求 §2.1 与类型、DDL 不一致，哪方同步？

**问题原意**：需求中的示例类型与已验证的 `src/contracts.ts`、`db/schema.sql` 字段不一致，需要指定同步方向，并区分数据库实际存储与应用读取形状。

**A 的建议**：需求示例追认已验证的代码，保留「场景事件」与「学员事件」的区别。理由：代码、fixture、DDL 与原校验器已经互相一致并通过 83/44/90，反向改代码会破坏 D1 基线与 B 的接入。

**可审阅差异**：

| 需求 §2.1 | 实际类型 | 实际存储 | 建议 |
| --- | --- | --- | --- |
| `RoadSegment { id, from, to, blocked }` | `{ id, name, from, to, geometry, blocked, hazard, block_reason }` | `road_segments` 的 `from_node_id` / `to_node_id` / `geometry_json` / `blocked` / `hazard` / `block_reason` | 需求补 `name/geometry/hazard/block_reason`；`from/to` 说明可指向楼栋或 Junction |
| `ActionDef { applies_to, cost, ... }` | `{ target_kind, weight, duration_sim, resource_id, resource_units, preconditions, critical }` | `action_catalog` 同名列；前置条件存 `preconditions_json` | 用 `target_kind` 替代 `applies_to`；用 `resource_id/resource_units` 替代 `cost`，不保留双重语义 |
| `Node { t_sim, events }` | `ScenarioNode { id, t_sim, label, events }` | `scenarios.nodes_json` | 需求补 `id/label`，与 DDL 的 JSON 形状一致 |
| `RunEvent.kind = disaster/ugc/action/verdict` | 学员事件 `RunEvent` 仅 `verdict/action/sort`；场景事件 `ScenarioEvent` 为 `ugc_appear/disaster_confirm/road_hazard` | `run_events.kind` 仅允许 `verdict/action/sort`；场景事件存 `scenarios.nodes_json` | 需求拆成两个类型；不得把 disaster/ugc 写进 `run_events` |
| `ScoreResult.breakdown` | `ScoreResult.details`（另有可选 `sorting`） | `runs.score_json` 存完整 `ScoreResult`；`runs` 另有四项与总分列 | 需求改为 `details`，说明数据库列是查询摘要、JSON 是权威明细 |
| 未列 `RunRecord` | `{ run_id, scenario_id, branch, playback_speed, events, resource_occupancy }` | `runs` + `run_events`；占用区间在 fixture 中由动作派生 | 需求补 `branch/playback_speed/resource_occupancy` 的口径 |

**B 需确认**：界面读取的是 JSON 解析后的类型还是数据库扁平列；是否同意把 `details` 作为复盘明细唯一来源；是否需要在导出中保留 `score_json` 原样。

**负责人/检查点**：A 主笔、B 确认；D1-v2 记录，D2 冻结前同步需求与 DDL 注释。

### 5.2 没有预置路线，B 如何交付 D2 路径线？

**问题原意**：当前 fixture 没有路径数据，B 的地图路径线不能靠前端猜。

**A 的建议**：D1-v2 以 `getRoute` 返回 `null` 独立验收，页面显示「路径计算待引擎接入」。D2 由 A 优先交付可导入的寻路纯函数，并提供同一组起终点在封路前后的验收输入；B 只消费 `RouteResult`。

- `ready`：节点序列、路段 id、折线点、`length_px`；
- `unreachable`：已计算但无可通行路径，与 `null`（待接入）分开显示。

若两轨改选 `preset_routes`，先约定起终点、节点序列、状态时刻、数据来源与版本，再扩契约。

**B 需确认**：路径线是画在 SVG 上还是独立图层；`unreachable` 的文案与颜色；是否需要显示 `road_ids` 以便封路高亮。

**负责人/检查点**：A 交付函数，B 接 UI；D2 晚、D6 联调。

### 5.3 精度声明是否进入 fixture？

**问题原意**：精度声明放在 fixture、README 还是页面，容易三处漂移。

**A 的建议**：不扩 fixture 形状；共用 `PRECISION_NOTICE` 常量，README 与地图页脚使用完全相同的文本。CD-05 的验收对象是**可见页面与 README**，不是 JSON 字段。若 B 有数据导出需求，再共同决定 metadata 字段。

**B 需确认**：地图页脚位置与字号；导出 JSON 是否需要携带声明；截图能否同时看到页脚与训练水印。

**负责人/检查点**：A 提供常量并核对 README，B 接页脚并截图；D5/D7 验收 CD-05。

### 5.4 跨区增援指图上路径较长，还是模拟耗时较长？

**问题原意**：北区到东区约 800–1000 m，但当前 A2 固定 60 模拟秒；需要明确「长」是图上路径还是动作耗时。

**A 的建议**：D1-v2 不做任何换算，A2 仍读动作目录的 60 秒。两种可选语义：

1. **路径相对长度**：只影响地图路径线与 `length_px`，不改变动作耗时；若采用，修订 §7.3 中容易被读成耗时结论的表述。
2. **另建行程耗时**：新增行程时间字段，与动作 `duration_sim`、评分基准隔离；不得改变 83/44/90 的既有计算。

推荐先采用第 1 种，保持评分确定性；第 2 种须在 D2 另立验收例后再启用。

**B 需确认**：路径线旁是否显示长度；是否需要在动作面板显示「增援耗时」；若显示，文案必须区分「图上长度」与「模拟耗时」。

**负责人/检查点**：A+B；D2 记录选择，D4 前不得悄然改变评分。

### 5.5 Junction 是否新增第九张表？

**问题原意**：校门/路口是路网节点，当前没有独立表，需决定是否迁移。

**A 的建议**：D1-v2 保持八表，不新增表；Junction 位置由路段几何派生，引用由应用校验。D2 若数据库外键或查询确实需要，再与 B 共同确认增量迁移；迁移时 A 提供兼容读取（优先读 junction 表，缺失时回落几何派生）并通知 B。当前 `db/schema.sql` 已注明该口径。

**B 需确认**：页面是否只需要 `GATE3` 的显示名与坐标；是否需要按路口查询路段；若不需要，D2 可继续不建表。

**负责人/检查点**：A 说明兼容读取，B 确认查询需求；D2 结束前冻结。

## 6. 待补凭证

- [ ] 用户补拍本轮 Qoder 对话截图（接口实现、验收命令与失败修正过程）。
- [ ] B 接入后的地图页脚 CD-05 截图（需同时看到精度声明与训练水印）。
- [ ] B 的 375px、道路积水/正式封闭图例、路径待接入与实时评分待接入空态截图。
- [ ] D4 实时引擎「补做 A4 → 90；前置未满足 → 拒绝且仍 83」的 CLI 与页面证据。
- [ ] D5 公网未登录与手机实测记录；私有站结果不能替代。
