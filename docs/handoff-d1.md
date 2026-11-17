# D1 → B 轨交接说明（v4.1 真实校区数据）

日期：2026-11-17　状态：契约与基准数据校验通过；云端连通性见文末。

B 只需读取 [`fixtures/canonical-run.json`](../fixtures/canonical-run.json) 和 [`src/contracts.ts`](../src/contracts.ts)，不需要猜字段。地图投影另见 [`fixtures/buildings.json`](../fixtures/buildings.json)，手算口径见 [`fixtures/canonical-run.md`](../fixtures/canonical-run.md)。

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

同一轮推演按 `run_id` 读取 `events`，按 `seq` 排序即可完整还原。当前 D1 样例包含 `run-jia-1x`（83）、`run-yi-1x`（44）、`run-jia-plus-a4`（90）。

## 2. 三个容易接错的字段关系

1. **`appears_at_sim` 管可见性。** 上报在该模拟时刻之前不可见；它不等于判断结果，也不等于事后真值。
2. **`judgment_windows` 管计分。** U1 在 `[30,90)` 判「待核」正确，在 `[90,∞)` 判「真报」正确；t=90 的 `disaster_confirm` 事件是切换点，同时给 N7 增加灾情标注。
3. **`event_truth` 只管楼栋定位与复盘真值。** U9 的位置参考楼栋是 **N7**；积水阻断对象 **R-N7E** 由 t=140 的 `road_hazard` 事件单独引用，A5 封路作用于该路段。**定位与改道分别核对，不得把路段 id 塞进 `building_id`。**

动作流水必须同时保留：

- `submitted_at_sim`：学员提交时刻；
- `completed_at_sim`：通过时为提交 + `duration_sim`，被拒时为 `null`；
- `status` / `reject_reason_code` / `reject_reason`：通过与拒绝；
- `attempt`：同一 `action_id + target_id` 的尝试序号；
- `resource_usage`：通过动作的占用区间，拒绝动作为 `null`。

## 3. 界面必须遵守的样例规则

- **A3 → A4**：同楼栋 A3 警戒完成后才允许 A4 广播疏散。甲做 A3（100→130）、漏 A4；甲补做分支于 150 提交 A4（150→170）。乙在 A3 未完成时于 150 连续 3 次提交 A4，全部被拒，后 2 次计违规。
- **A6**：对象楼栋必须有灾情标注（N7 在 90 秒获得），且同一楼栋不可重复断电。北一食堂 CN1 无标注，用于拒绝测试；N7 在 110 断电完成于 145，150 再次提交被拒。
- **违规**：同一动作、同一对象首次被拒不计违规；之后每次提交扣 15。界面展示拒绝原因，不能静默吞掉。
- **并行**：乙分支 A2（220→280）与 A3（250→280）并行合法，因为分别占用 `rescue_team` 与 `barrier_team`。资源容量按 `scenario.resources` 校验。
- **排序**：只在 `t_end = 300` 开放，选 3 条；正确答案 `U2, U8, U4`，不影响四项分数。
- **倍速**：1× 与 4× 使用相同 `t_sim` 序列；甲分支 U1@30、A1 完成@75，响应恒为 45 模拟秒。真实点击耗时单独统计，不计分。
- **回合内时刻**：判读、改判、定位、提交动作的 `t_sim` 一律等于当前节点（FR-4.7）；220、250 是纯推进回合。

## 4. A 已验证 / 待联调

**已验证**

- `npm run typecheck`：TypeScript 严格模式通过。
- `npm run validate`：8 楼栋、1 路口、8 路段、10 上报、6 动作、3 流水；引用、时序、前置条件、资源占用、判断窗口、排序与分数全部通过。
- 三份流水复算：83 / 44 / 90，逐项与手算表一致。
- U9 楼栋定位 N7；R-N7E 由 t=140 disaster 事件单独校验，`event_truth` 不含路段字段。
- 1× / 4× 响应时长均为 45 模拟秒。
- SC-03 / SC-03b / SC-04 / SC-05 / SC-07 / SC-08 自动检查通过。
- 八表 DDL：`db/schema.sql`（含 `zone` / `floors`；路段端点可指向楼栋或路口）。

**待联调（B 确认）**

- 实际 SVG 渲染、375px 布局、点选与动作面板交互，由 B 在界面中验证。
- 云端 Sites 建表、Function 内读写与 Cloud Agent 真实调用（`D1_OK`）已实测通过；同一检查重复调用返回 `internal_error`，D2 需复用 Agent/Environment/Session 资源并保留预置剧本、上报与得分摘要兜底。详见 [`docs/qoder-evidence/d1-cloud-verification.md`](qoder-evidence/d1-cloud-verification.md)。
- D3 规则引擎与 D4 生产评分器尚未交付；D4 前界面可使用本样例的 `expected_scores` 做静态对照，但不能把静态对照当作实时评分。
- D2 核对平台数据库方言后冻结表结构；当前 DDL 为初始基线。Junction 暂不单列第九表，D2 若需数据库级外键再共同确认。

## 5. 命令与入口

```bash
npm install
npm run check:d1
```

- 契约：[`src/contracts.ts`](../src/contracts.ts)
- 样例数据：[`fixtures/canonical-run.json`](../fixtures/canonical-run.json)
- 地图投影：[`fixtures/buildings.json`](../fixtures/buildings.json)
- 手算说明：[`fixtures/canonical-run.md`](../fixtures/canonical-run.md)
- 校验器：[`scripts/validate-canonical.ts`](../scripts/validate-canonical.ts)
- DDL：[`db/schema.sql`](../db/schema.sql)
- 凭证：[`docs/qoder-evidence/README.md`](qoder-evidence/README.md)
