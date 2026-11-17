# D1 → B 轨交接说明（v4.1 真实校区数据）

日期：2026-11-17　状态：契约、基准数据与 D1-v2 只读接口校验通过；云端连通性见文末。

B 通过 [`src/fixture-port.ts`](../src/fixture-port.ts) 获取地图派生、可见性、判断窗、只读回放与静态评分，不需要自己再写寻路、判分或违规统计。原始数据仍以 [`fixtures/canonical-run.json`](../fixtures/canonical-run.json)、[`fixtures/buildings.json`](../fixtures/buildings.json) 和 [`src/contracts.ts`](../src/contracts.ts) 为准；手算口径见 [`fixtures/canonical-run.md`](../fixtures/canonical-run.md)。

## 0. A/B 接口约定（原文，交接时不再改写）

> **A 提供有来源的数据和判定结果，B 负责展示及用户交互。** 每个接口都要让 B 区分「权威引擎结果」「标准样例回放」与「能力待接入」。没有路径返回 `null`，页面显示「路径计算待引擎接入」。操作偏离标准流水时，静态得分返回 `null`，页面显示「实时评分待引擎接入」。倍速只影响真实播放等待。B 使用 A 导出的接口和状态，不再维护一份寻路、判分或违规统计逻辑。

## 1. B 从哪里读

| 用途 | JSON 字段 | 说明 |
| --- | --- | --- |
| 地图楼栋 | `buildings[]` | `polygon` 是 SVG 多边形点集；`zone`、`category`、`floors`、`capacity`、`risk_tag`、`adjacency` 直接用于图层与点选。`floors: null` 表示大跨度通高，界面显示「通高」 |
| 校门/路口 | `junctions[]` | 只含 `GATE3`（3 号门，近北区），`kind = "gate"`。**不计入楼栋数**，不要渲染成可点选楼栋 |
| 地图路段 | `road_segments[]` | `geometry` 是折线端点；`from` / `to` 可指向楼栋或 `GATE3`；`blocked` 是正式封闭状态，`hazard` 是积水/火灾等自然灾情，二者分开显示 |
| 回合推进 | `scenario.nodes[]` | 14 个节点，按 `t_sim` 严格递增；进入节点时投放 `events`。空 `events` 的 220、250 是推进回合，300 是末回合 |
| 当前可见上报 | `ugc_reports[]` + 当前节点 | 只显示 `appears_at_sim <= 当前 t_sim` 的上报；**不得提前展示未到线索** |
| 判读依据 | `ugc_reports[].judgment_windows` | 学员提交时刻落在哪个窗口，就与 `expected` 比对；改判按改判时刻覆盖前次 |
| 复盘真值 | `ugc_reports[].event_truth` | 只有 `is_real`、`locatable`、`building_id`；**没有路段字段** |
| 动作面板 | `action_catalog[]` | 对象类型、`duration_sim`、资源、前置条件；合法性由 D3 规则引擎判定，不由 LLM 判定 |
| 本轮标准项 | `scenario.standard_actions` / `critical_items` | 命中率按 `action_catalog.weight` 计算；关键项是标准项子集 |
| 推演流水 | `runs[].events[]` | 按 `seq` 升序还原判定、动作、排序；`payload` 含提交/完成/拒绝原因 |
| 资源占用 | `runs[].resource_occupancy` | 并行动作的合法占用区间，可按时间段显示资源条 |
| 评分对照 | `expected_scores` | 三份流水的四项与总分基线；B 的界面结果应逐项一致 |

同一轮推演优先用 `replayTo` 读取，不要在前端重新推导状态；原始 `runs[].events` 只用于导出或核对。当前 D1 样例包含 `run-jia-1x`（83）、`run-yi-1x`（44）、`run-jia-plus-a4`（90）。

## 2. D1-v2 只读接口（静态接入）

入口是 [`src/fixture-port.ts`](../src/fixture-port.ts)。全部为纯函数，数据由参数传入，不依赖 Node 文件 API。`createFixturePort(fixture, mapSource?)` 绑定一份 fixture 并预派生地图；也可以单独调用下列函数。下表的 `visibleReportsAt` / `windowAt` / `replayTo` / `getScore` 是绑定后的方法；独立导出的同名函数第一个参数接收 fixture。

| 接口 | 用途 | 返回与空态 |
| --- | --- | --- |
| `buildMapView(source, { padding? })` | 校验地图引用，派生路口位置、每条路段折线长度（px）、bounds 与 viewBox | 成功返回 `MapView`；数据错误抛 `FixturePortError`，含 `code` 与具体 `object_id` |
| `visibleReportsAt(t)` | 按出现时间返回 `appears_at_sim <= t` 的上报 | 数组按出现时间排序；同一时刻保持 fixture 原顺序 |
| `windowAt(id, t)` | 返回该时刻适用的判断窗口 | 左闭右开，末窗开放；上报出现前返回 `null` |
| `replayTo(runId, { seq?, t_sim? })` | 按序号或模拟时刻截断并还原一轮流水 | 未知 run 返回 `null`；非法截断抛 `REPLAY_INVALID_CUT` |
| `getScore(runId, currentEvents?)` | 读取权威评分明细 | 仅完整匹配基线流水时返回 `ScoreResult`；交互流水或未知 run 返回 `null` |
| `getRoute(query)` | D2 寻路入口的空态 | 静态模式固定 `null`；D2 返回 `RouteResult` 的 `ready` 或 `unreachable` |

```ts
import fixture from '../fixtures/canonical-run.json';
import { createFixturePort } from './fixture-port';

const port = createFixturePort(fixture);
const visible = port.visibleReportsAt(80);
const snapshot = port.replayTo('run-jia-1x', { seq: 20 });
const baseline = port.getScore('run-jia-1x'); // 仅用于载入原始示例
```

交互中不要省略 `getScore` 的第二个参数；当前流水的任何差异都会得到 `null`，此时显示「实时评分待引擎接入」，不要回退到 `expected_scores`。`getRoute` 的 query 可携带当前 `road_segments`（按回放道路状态更新 `blocked` / `hazard` 后传入）；静态模式忽略该字段并返回 `null`，D2 才使用它计算路径。

**地图。** 路口作为 `from` 时取折线首点，作为 `to` 时取末点；同一路口被多条路段引用时坐标必须一致。孤立路口、折线不足两点、端点未知、端点矛盾、零长度路段都会报出具体对象。`GATE3` 从 `R-N7E` 派生为 **(500,520)**；viewBox 覆盖楼栋全部顶点与路段全部折点，样例为 `40 40 880 560`。B 只消费派生结果，不要在页面里写死坐标或画布尺寸。

**回放。** `seq` 与 `t_sim` 同时给出时都是上界：`events` 只包含 `seq <=` 且 `t_sim <=` 截断点的记录，并按 `seq` 排序。快照时刻规则：

- 两者都不给：`scenario.t_end`；
- 只给 `seq`：截断内最后一条事件的 `t_sim`；
- 只给 `t_sim`：`min(t_sim, t_end)`；
- 两者都给：`min(t_sim, 截断内最后一条事件的 t_sim, t_end)`。

这样不会把截断点之后的学员操作、末回合排序或后续场景事件提前展示。快照返回 `scenario_events`、`events`、`latest_verdicts`（含 `supersedes_seq`）、`actions`（含 `attempt`、拒绝码与原因）、`sorting`、`resource_occupancy`（已记录区间）与 `active_resource_occupancy`（快照时刻仍占用）以及 `roads`。B 不需要再从 `runs[].events` 自行推导这些状态。

**道路状态。** `hazard` / `hazard_at_sim` / `hazard_description` 表示自然灾情，`formally_closed` / `closed_at_sim` / `closed_by_action_seq` 表示正式封闭。样例中 `R-N7E` 在 t=140 已积水但未封闭；A5 于 t=140 提交、t=165 完成，因此 t=164 仍显示未封闭，t=165 才转为正式封闭。B 用不同文字和图例展示，不能把两者合并成一个「阻断」布尔值。

**拒绝与评分。** 动作目录以 `fixture.action_catalog` 为准：A4 的 `requires_completed_action` 指向 A3；A6 使用 `requires_disaster_annotation` 与 `not_powered_off`。回放中的 `attempt` 是同一 `action_id + target_id` 的尝试序号，拒绝码与原因直接来自基线流水。违规明细只读 `ScoreResult.details.violation_event_seqs`，甲为 `[14,20]`、乙为 `[9,14,15]`；B 不自行统计。`getScore` 省略 `currentEvents` 只用于明确载入的原始示例，交互中必须传入当前流水；新增、删减、替换、重排或改动 payload 都会返回 `null`。

**空态文案。** 直接使用导出的常量，不要另写近似文本：

- `ROUTE_PENDING_TEXT = "路径计算待引擎接入"`
- `ROUTE_UNREACHABLE_TEXT = "路径已计算，但当前路网无可通行路径"`（D2 使用）
- `SCORE_PENDING_TEXT = "实时评分待引擎接入"`
- `PRECISION_NOTICE`：需求 §6 的统一精度声明，README 已核对；地图页脚由 B 接入并在页面验 CD-05。

**倍速。** 同一 run 可以 1× 或 4× 播放，`playback_speed` 只是记录值。B 用同一个 `t_sim` 序列控制真实等待时间，不要把 4× 当成另一条流水，也不要复制 4× 记录。甲分支两种速度的响应都是 45 模拟秒。

## 3. 三个容易接错的字段关系

1. **`appears_at_sim` 管可见性。** 上报在该模拟时刻之前不可见；它不等于判断结果，也不等于事后真值。
2. **`judgment_windows` 管计分。** U1 在 `[30,90)` 判「待核」正确，在 `[90,∞)` 判「真报」正确；t=90 的 `disaster_confirm` 事件是切换点，同时给 N7 增加灾情标注。
3. **`event_truth` 只管楼栋定位与复盘真值。** U9 的位置参考楼栋是 **N7**；积水阻断对象 **R-N7E** 由 t=140 的 `road_hazard` 事件单独引用，A5 封路作用于该路段。**定位与改道分别核对，不得把路段 id 塞进 `building_id`。**

动作流水必须同时保留：

- `submitted_at_sim`：学员提交时刻；
- `completed_at_sim`：通过时为提交 + `duration_sim`，被拒时为 `null`；
- `status` / `reject_reason_code` / `reject_reason`：通过与拒绝；
- `attempt`：同一 `action_id + target_id` 的尝试序号；
- `resource_usage`：通过动作的占用区间，拒绝动作为 `null`。

## 4. 界面必须遵守的样例规则

- **A3 → A4**：同楼栋 A3 警戒完成后才允许 A4 广播疏散。甲做 A3（100→130）、漏 A4；甲补做分支于 150 提交 A4（150→170）。乙在 A3 未完成时于 150 连续 3 次提交 A4，全部被拒，后 2 次计违规。
- **A6**：对象楼栋必须有灾情标注（N7 在 90 秒获得），且同一楼栋不可重复断电。北一食堂 CN1 无标注，用于拒绝测试；N7 在 110 断电完成于 145，150 再次提交被拒。
- **违规**：同一动作、同一对象首次被拒不计违规；之后每次提交扣 15。界面展示拒绝原因，不能静默吞掉。
- **并行**：乙分支 A2（220→280）与 A3（250→280）并行合法，因为分别占用 `rescue_team` 与 `barrier_team`。资源容量按 `scenario.resources` 校验。
- **排序**：只在 `t_end = 300` 开放，选 3 条；正确答案 `U2, U8, U4`，不影响四项分数。
- **倍速**：1× 与 4× 使用相同 `t_sim` 序列；甲分支 U1@30、A1 完成@75，响应恒为 45 模拟秒。真实点击耗时单独统计，不计分。
- **回合内时刻**：判读、改判、定位、提交动作的 `t_sim` 一律等于当前节点（FR-4.7）；220、250 是纯推进回合。

## 5. A 已验证 / 待联调

**已验证**

- `npm run typecheck`：TypeScript 严格模式通过，覆盖新增 `src/fixture-port.ts` 与 `scripts/validate-d1-v2.ts`，保持 `noUncheckedIndexedAccess`。
- `npm run check:d1-v2`：先跑原 D1 基线，再跑 D1-v2 验收；完整输出见 [`docs/qoder-evidence/d1-v2-local-validation.log`](qoder-evidence/d1-v2-local-validation.log)。
- 原 D1 复算未变：8 楼栋、1 路口、8 路段、10 上报、6 动作、3 流水；三份流水 83 / 44 / 90，逐项与手算表一致。
- 地图：两份 fixture 的三个投影深度相等；`GATE3` 派生为 (500,520)；viewBox 覆盖 x[60,900]、y[60,580]；8 条路段长度均 >0；三点折线按段求和为 10，平移与改名后仍由输入决定；孤立路口与端点矛盾均报出对象。
- 可见性与判断窗：t=80 依次为 U1/U3/U2/U4/U5 且无 U6；t=300 共 10 条；U1 在 30 为待核、90 切换、100 为真报。
- 甲回放：seq20 有 5 条 accepted、4 条 rejected、5 条占用；U1 最新改判指向首判 seq2；A6 N7 的 `attempt` 为 1/2/3，seq19 是首次被拒、不计违规。
- 道路状态：`R-N7E` 在 t=140 已积水未封闭，t=164 仍未封闭，t=165 才由 seq17 的 A5 正式封闭；封路组在 140 仍占用、165 已释放。
- 拒绝与违规：甲 seq13/14 为 CN1 `TARGET_NOT_APPLICABLE`、seq19/20 为 N7 `STATUS_CONFLICT`，计罚 `[14,20]`；乙 A4 seq13/14/15 均为 `PRECONDITION_NOT_MET`，计罚 `[9,14,15]`。
- 静态得分：`getScore('run-jia-1x')` 为 83；改动、删减、新增、重排事件及未知 run 均返回 `null`；1×/4× 模拟时刻序列一致，响应均为 45 秒。
- 空态与硬编码：`getRoute` 返回 `null`；实现内无楼栋/路口专名、样例坐标或固定 viewBox；只读调用未修改输入 fixture；README 含统一精度声明。
- 八表 DDL：`db/schema.sql`（含 `zone` / `floors`；路段端点可指向楼栋或路口）。

**待联调（B 确认）**

- **B 页面待测**：SVG 渲染、375px 布局、点选、动作面板、地图页脚 CD-05、道路积水/封闭图例、路径空态与评分待接入文案，均需 B 在界面中验证；本仓库没有页面，不以字符串存在当作 UI 已验收。
- **D4 实时引擎待接入**：本轮 `getScore` 只返回基线 `expected_scores`，不是实时评分器。D4 必须用 A 的评分函数走「同一剧本两种选择 → 83/44」及「补做 A4 一正一反 → 90/仍 83」。
- **D2 路径待接入**：本轮 `getRoute` 固定 `null`，不提前实现 Dijkstra。D2 交付可导入的寻路纯函数与封路前后验收输入，并区分 `null`（待接入）与 `unreachable`（已计算但不可达）。
- 云端 Sites 建表、Function 内读写与 Cloud Agent 真实调用（`D1_OK`）已实测通过；同一检查重复调用返回 `internal_error`，D2 需复用 Agent/Environment/Session 资源并保留预置剧本、上报与得分摘要兜底。详见 [`docs/qoder-evidence/d1-cloud-verification.md`](qoder-evidence/d1-cloud-verification.md)。
- D3 规则引擎与 D4 生产评分器尚未交付；D4 前界面只能把本样例的静态对照标为「示例回放」，不能当作临场评分。
- D2 核对平台数据库方言后冻结表结构；当前 DDL 为初始基线。Junction 暂不单列第九表，D2 若需数据库级外键再共同确认。
- D5 首次公开部署后，B 用无痕未登录会话与手机实测；私有站 401 与本次静态验证都不能替代该验收。

## 6. 命令与入口

```bash
npm install
npm run check:d1-v2
```

`check:d1-v2` 会依次执行 `check:d1`（typecheck + 原 fixture 校验）和新增的 D1-v2 验收；只需原基线时运行 `npm run check:d1`。

- 前端只读接口：[`src/fixture-port.ts`](../src/fixture-port.ts)
- 契约：[`src/contracts.ts`](../src/contracts.ts)
- 样例数据：[`fixtures/canonical-run.json`](../fixtures/canonical-run.json)
- 地图投影：[`fixtures/buildings.json`](../fixtures/buildings.json)
- 手算说明：[`fixtures/canonical-run.md`](../fixtures/canonical-run.md)
- 原校验器：[`scripts/validate-canonical.ts`](../scripts/validate-canonical.ts)
- D1-v2 验收：[`scripts/validate-d1-v2.ts`](../scripts/validate-d1-v2.ts)
- 完整输出：[`docs/qoder-evidence/d1-v2-local-validation.log`](qoder-evidence/d1-v2-local-validation.log)
- DDL：[`db/schema.sql`](../db/schema.sql)
- 凭证索引：[`docs/qoder-evidence/README.md`](qoder-evidence/README.md)
