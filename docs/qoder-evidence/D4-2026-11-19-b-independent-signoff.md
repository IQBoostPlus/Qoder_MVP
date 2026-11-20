# D4 · 2026-11-19 · B 轨独立复验：接入 A 的 D3/D4 引擎 + 沙盘地图融合

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | FR-4.1 / FR-4.6 / FR-4.7 / FR-8.3、JW-09、TC-06 / TC-07、VS-01 / VS-02；质量门 Q6 |
| 状态 | 已完成（对话截图与页面截图待补） |

## 1. 想完成什么

A 轨在 `ea7c9de` 交付了 D3 动作规则引擎与 D4 实时评分器，交接单明确「B 轨签认以独立运行结果为准」。
本步骤要完成三件事：

1. 把 A 的引擎接进 B 的推演舱，让**临场评分**真正由本轮事件算出（Q6 里程碑），替换掉此前的「实时评分待引擎接入」占位。
2. 保留并行会话的「建筑事务所实体比例模型」沙盘，同时把 B 的 LOD / 标注防挤层重新叠上去（用户选定「融合」方向），并补上 A6 断电的地图表达。
3. 以 B 轨自己的独立运行结果签认 D4，不沿用 A 的本地记录。

## 2. 在 Qoder 中做了什么

### 2.1 先保住在制品，再合并（用户授权）

合并前工作区同时存在两个 B 会话的未提交成果（模型地图 + D4 面板）。经用户授权「checkpoint 提交后合并」：

- `d4c4c89` feat: B-side D4 panels + sandbox model map checkpoint before A D3/D4 merge
- `9775ccc` merge: integrate A's D3 action engine + D4 live scoring (ea7c9de)

6 处冲突的处置口径：

| 文件 | 处置 |
| --- | --- |
| `src/composables/useDrillRound.ts` | 整体取 A 版（`--theirs`）。canWrite / furthestRoundIndex / finished / 一次性 top-3 排序 / finishDrill 停表以引擎侧语义为准 |
| `src/views/DrillView.vue` | 取 A 版为基线，再把 B 的动作面板 / 信息流 / 双分支对照手工叠加回去 |
| `src/components/CampusMap.vue` | 取 B 模型版为基线，手工移植 A 的 `overlay.powerCuts` 接线，另加标记防挤 |
| `src/styles/console.css` | 并集（保留 B 的 D4 组件样式与移动端页签规则） |
| `docs/qoder-evidence/README.md`、`docs/quality-verification.md` | 并集，双方记录都保留 |

**语义对齐时被废弃的 B 旧实现**：可重复提交的全 10 条排序、任意回合可写。
现行为：排序仅一次、长度恒为 `min(SORT_LIMIT, 可见上报数)` = 3、去重且必须已投放；回看回合只读。

### 2.2 临场评分接线（不伪造）

- `result = finished ? port.scoreRound(drill.currentEvents.value) : null`，未结算不显示任何分数。
- 双分支对照走 `port.replayTo(runId, { t_sim: tEnd })` + `port.getScore(runId, snap.events)`，
  **恒带账本第二参数**；偏差返回 null 时显示共享常量 `SCORE_PENDING_TEXT`，不回退基线。
- 对照区标题副签为「示例回放 · 非临场」，与上方临场结算分开；推演入口徽标用 `DRILL_MODE_BADGE`，不标「示例回放」。
- 动作合法性、拒绝原因码与文案、资源占用、完成时刻全部来自 `port.judgeAction`，界面原样展示；
  `ActionEngineError` 捕获后显示 `error.message`，不自行编造理由。

### 2.3 B 新增面板（叠在 A 的 DrillView 上）

- **R1b 动作面板**：六动作目录驱动，对象按 `target_kind`（A5→路段，其余→楼栋），
  显示前置条件原文、已尝试次数、每次 attempt 的 seq / 状态 / 完成时刻或拒绝原因。
- **R3c 信息流**：投放 / 判读 / 动作 / 排序 / 路况按模拟时刻合并，六个过滤 chip；
  路况区分自然灾情与正式封闭（不合并双态），断电单列；回看时随快照时刻截断，不泄漏未来线索。
- **R8b 双分支对照**：三条 D1 基线流水的示例回放总分。
- 修复 `noUncheckedIndexedAccess` 下 `actionTarget[def.id]` 为 `string | undefined` 的 TS2345：
  `attemptsFor` 形参改 `string | undefined` 并提前返回空数组。

### 2.4 地图融合 + 断电标记 + 标记防挤

- 保留模型版的斜正交投影（`KY=0.574 / KZ=0.819`）、画家排序、类别体量与固定 LIGHT 色板；
  该版本已自带 LOD（`screenScale` + ResizeObserver + 恒定屏幕字号 + 贪心标注取舍 + 缩放钳制），故 B 的防挤层无需重写，只需补标记层。
- 移植 A 的 `powerCuts`：楼栋 aria 追加「已断电 @{at_sim}」，新增 `mark-powercut`（闪电字形 + 砖红点 + 图例「断电」）。
- **新写标记防挤**：`MARK_PRIO`（disaster 0 / powercut 1 / closed 2 / hazard 3 / cordon 4 / rescue 5）排序后，
  在屏幕空间按 pill 矩形贪心检测相交并向上推移（`m.dy -= rect.y1 - hit.y0 + 6`，guard 40）；
  `labelPlan` 的 `placed` 以 `markRects`  seeding，使楼栋标注让位于指挥标记。
- 修掉一处合并期误写的 aria 表达式 `isSelected('building', cat === b.id ? b.id : b.id)` → `isSelected('building', b.id)`。

## 3. 如何验证

全部为 B 轨独立运行。CLI 完整输出见 [`d4-b-independent-gates.log`](d4-b-independent-gates.log)，
浏览器逐项原始输出见 [`d4-b-independent-browser.log`](d4-b-independent-browser.log)。

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| D1–D4 回归 + 评分手算核对 | `npm run check:d4` | 通过（含 26 动作重判、违规下限、单次命中计分、跨结束时刻截断、排序非法/重复/错序/一次性/回看/重置） |
| 类型 + 生产构建 | `npm run typecheck:app`、`npm run build` | 通过，`✓ built in 268ms`，dist/assets/index-BZ71Ck4-.js 263.32 kB（gzip 83.10 kB） |
| 甲路径临场评分 | 浏览器实操真实控件回放 21 事件 | **83**，80/100/80/70，响应 45s·seq1，违规 [14,20]，定位 10/10，排序正确，账本 21 行 |
| 甲 + A4@150 | 同上回放 22 事件 | **90**，80/100/100/70，命中权重 10/10，违规 [14,21]，账本 22 行 |
| 乙路径 | 同上回放 18 事件 | **44**，60/0/50/55，响应 250s·seq16，违规 [9,14,15]，定位 9/10，账本 18 行 |
| 甲 + 早 A4@100 | 时序内插入后回放 | A4 于 seq11 被拒 `PRECONDITION_NOT_MET 同楼栋 A3 警戒必须先完成`；总分仍 **83**、命中 80；违规引用随序号平移为 [15,21]，账本 22 行 |
| A5 封路 → 道路双态 | T+140 提交，T+150 / T+220 对照 | 完成前「积水 @140 / 未封闭」，完成后「已封闭 @165 · seq1」；hazard 与 blocked 不合并 |
| A5 封路 → 路径改道 | GATE3→N7 三时刻对照（封闭**有灾情**的 R-N7E） | T+130 直连 120.0px → T+150 改道 660.0px（备用路 R-N1-GATE3）→ T+220 仍 660.0px；query 恒带 28 条路段状态 |
| A5 封路 → 真实不可达 | N7→GATE3（封闭**无灾情**的备用路 R-N1-GATE3） | T+140 未完成时 ready 660.0px；T+220 已封闭 @165·seq1 → **unreachable**「路径已计算，但当前路网无可通行路径」；R-N7E 仍「积水 @140 / 未封闭」，地图出现 mark-closed 封闭·seq1 |
| 同秒资源占用 | T+100 连提 A2 / A3 | 均 accepted；救援队 100→160·seq1、警戒组 100→130·seq2，其余四资源空闲 |
| A6 断电时刻表达 | T+110 提交，T+130 / T+150 对照 | T+130 无断电标记；T+150 出现 `mark-powercut 已断电 @145` + 态势行 + 信息流「@145 路况 … seq3」 |
| 拒绝占 seq / attempt 递增 | A6→CN1 连提两次 | seq4 / seq5，均 `TARGET_NOT_APPLICABLE 对象楼栋必须已有灾情标注`，第1次 / 第2次 |
| 回看只读 | furthest=T+300 后回跳 T+150 | HUD「回看只读」；6 个动作 select + 6 个提交按钮全 disabled；判读 select 不渲染、按钮 disabled；排序入口 disabled、结算按钮不存在；回 T+300 恢复 |
| 标记/标注防挤 | 屏幕空间矩形相交计数，4 档缩放 × 2 时刻 | 实际到达 0.7 / 1.1 / 2.7 / 5.0×，pill×pill、pill×label、label×label **全为 0**；标记恒 5/5 不丢弃；标注 4→5→21/22→22 随 LOD 递增 |
| 375px 布局 | 同源 iframe 375×812 | scrollWidth 375，**无横向滚动**；6 张动作卡均 316px 单列、maxRight 341；chip 与双分支对照无溢出 |
| 双主题对比度 | alpha 逐层合成后算 WCAG 比值 | ops 最小 **6.76**、daylight 最小 **4.73**，新增组件全部 ≥ 4.5（AA） |
| 控制台 | `list_console_messages` | 10 条全为 vite debug；**warning 0 / error 0 / page error 0** |

### 3.1 两次自我纠错（记录以免误信）

1. **早 A4 路径第一次跑法无效**：把 extra 事件追加在 `run.events` 之后执行，会先跳到 T+300 再回跳 T+100，
   `canWrite=false` 导致 `submitAction` 返回 null，账本仍 21 行 —— 那次「83」只是重跑了一遍甲，不构成验证。
   改为按 `t_sim` 归并插入后重跑，才真正观察到 seq11 的拒绝与序号平移。
2. **对比度探针背景取法错误**：初版把首个非透明祖先的 `rgba` 当不透明背景，daylight 下取到
   `rgba(26,36,54,0.06)`，算出最小 1.00 的假结果。改为自底向上合成所有半透明层后重测，得 6.76 / 4.73。
   此前记录的 ops 14.02 / 9.05 / 6.32 一并作废，以本条为准。
3. **A5 对象搞混差点误判 A 的记录**：B 先封闭了有积水的直达路 R-N7E，得到 660px 改道，
   一度以为 A 的 D3「t=220 不可达」记录不可复现。回读 A 的凭证原文才发现其封闭的是
   **无灾情的备用路 R-N1-GATE3**，两者对象不同、结论并不冲突。改封备用路后 B 独立跑出了 unreachable。
   同轮还有一处标签错误：脚本未跳到 T+150 就采样，日志里原写「at150」的其实是 T+140，已按实际时刻更正。

### 3.2 未宣称的事项

- 页面截图未取到：Qoder 内置浏览器面板处于隐藏态，`take_screenshot` 失败；
  以 `evaluate_script` 的 DOM 实测输出与 CLI 完整日志作为等效凭证（见 §5）。
- 人工签认与独立试用用时未测；公网发布、云端 Agent、轮次持久化待后续阶段验收。
- 375px 总览下 1 个路口标注 pill 右缘被 svg 裁掉 7px（页面 scrollWidth 仍 375，不构成横滚），未宣称边缘标注完美。

## 4. 结论与后续

D4 的 B 轨独立复验**通过**：四条路径的临场总分与四个分项、响应秒数、违规账本引用、定位统计、排序判定
全部与契约期望一致，且分数确由本轮事件算出（补做 A4 使 83→90，早提 A4 被拒且仍 83）。
Q6「分数随临场动作变化」里程碑在 B 轨侧成立。地图融合方向达成：模型体量保留，标记与标注在 4 档缩放下零相交。

后续：
- 合并后的集成改动（`src/views/DrillView.vue`、`src/components/CampusMap.vue`）与本次凭证**尚未提交**，待用户授权。
- 375px 总览下 1 个路口标注 pill 右缘被 svg 裁掉 7px（页面不溢出），属边缘感知摆放的后续优化项。
- B 仍欠 A 五个跨轨待决问题的书面确认（见项目记忆 D1 冻结后待决问题）。

## 5. 待补凭证

- [ ] Qoder 对话截图：checkpoint 授权 + 合并方向决策（用户两次选择）
- [ ] Qoder 对话截图：融合方向「建筑模型体量 + LOD 防挤」的确认
- [ ] 页面截图：四条路径结算态（83 / 90 / 44 / 83）桌面 + 375px
- [ ] 页面截图：T+150 断电标记与防挤后的 N7 标记群、0.7× 与 5× 对照
- [ ] 页面截图：动作面板拒绝原因行、信息流过滤态、回看只读态

> 截图待补原因：内置浏览器面板隐藏导致 `take_screenshot` 不可用；本轮以
> [`d4-b-independent-browser.log`](d4-b-independent-browser.log) 的逐项 DOM 实测输出与
> [`d4-b-independent-gates.log`](d4-b-independent-gates.log) 的完整 CLI 输出作为等效凭证，均为当时实跑记录，非事后补填。