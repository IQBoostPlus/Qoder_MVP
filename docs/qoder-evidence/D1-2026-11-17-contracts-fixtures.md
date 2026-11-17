# D1 · 2026-11-17 · 契约冻结（B 轨草案）：contracts.ts + fixtures

| 项 | 内容 |
| --- | --- |
| 责任人 | A + B |
| 轨道 | 界面侧（B 草案）+ 引擎侧（A 基线） |
| 关联功能 | F1～F9 的数据基础（README 功能清单） |
| 状态 | 已完成，**契约已冻结，以 A 基线 `e9d4a07` 为准** |

## 1. 想完成什么

D1 上午契约冻结的 B 侧落地：把 `docs/requirements.md` v4.1 §2 数据契约、§5 手算样例、§7.4 校园数据子集逐字转成 `src/contracts.ts` 与 `fixtures/`，双分支 83/44 可被 Node 复算核对，供 A 确认后冻结。对应排期表 D1「上午共同冻结契约与手算样例」。

## 2. 在 Qoder 中做了什么

- 按顺序读取 README、requirements v4.1（§2/§4/§5/§7）、njit-campus-buildings.md、quality-verification v4.1、凭证约定；未读已废止的 mvp-spec.md。
- 生成 `src/contracts.ts`：Building / Junction / RoadSegment / ActionDef / Scenario / Node / RunEvent / ScoreResult / UgcReport（event_truth + judgment_windows 双标签）及 fixture 载体类型 CanonicalRun / CampusData。FR-4.7 节点取值约束留一行注释。
- 生成 `fixtures/buildings.json`：§7.4 的 8 栋（N7/N1/N2/N11/CN1/CN2/GYM/LIB）+ GATE3 + §7.3 全部 8 条路段；名称/分区/类别/层数/容量/风险照 §7.2；几何为规则占位多边形（viewBox 1000×700 量级），含 §6 精度声明全文。
- 生成 `fixtures/canonical-run.json`：6 动作目录（权重总 10、duration 45/60/30/20/25/35、A4 前置 A3、A6 双前置）、14 节点剧本（90 核实 disaster、140 U9+R-N7E 阻断、220/250 推进回合）、10 条上报双标签（U1 双窗口、U4/U5 不可定位、U9 楼栋字段=N7）、甲乙两分支完整流水与预算 ScoreResult（83/44）、复盘理由、排序答案 {U2,U8,U4}。乙分支 note 字段写明 A3 t=250 不可改（SC-08）。
- 生成 `fixtures/canonical-run.md`（§5 快照）与 `scripts/verify-fixtures.mjs`（fixture 一致性复算脚本，**非引擎实现**，不进界面代码）。
- 人工修正一处：验证脚本初版把违规误判为「attempt>1 的被拒提交」，与 §4「被拒后再次提交才计、首次被拒不计」不符（甲分支 seq19 是 N7 断电的首次被拒，前次尝试成功）。改为「同一动作+对象存在前次被拒后再被拒才计数」后全部通过。**fixture 数值未动。**

### 待 A 确认的契约口径（文档未定义的类型形状，B 采用保守编码）

1. `Scenario.start_building_id`：§2.1 字段列表未列，但 FR-2.1 与 §5.2 要求起始楼栋，已补入。
2. `Junction.position`：§2.1 未给坐标字段，地图渲染必需，已补 `[x,y]`。
3. `UgcReport.text`：§2.2 未列文本字段，界面渲染必需，取 §5.3 摘要原文。
4. `ActionDef.preconditions` 结构：文档只给文字规则，编码为判别联合（action_completed / target_has_disaster / not_executed_on_target）。
5. `ActionDef.cost`：文档未给任何资源数值，fixture 全部置 `{}`，**未发明数值**，待 A 定资源模型。
6. `Scenario.critical_items`：暂填 critical 动作 id（A2/A3/A4），语义待 A 确认。
7. `ScoreResult.breakdown` 与 RunEvent 各 payload 形状为 B 提案，见 contracts.ts。

## 3. 如何验证

方式：Node CLI 复算（无浏览器界面可截图，按约定以命令 + 完整输出为等效凭证）。
覆盖：CD-01/02/03/05、动作目录、节点与投放、双标签不变量、FR-4.7、尝试序号、完成时刻、§4 四指标逐项复算、SC-01/02/03/03b/08。

```
$ node scripts/verify-fixtures.mjs
PASS  CD-01 恰含 §7.4 的 8 栋且 id 唯一
PASS  CD-01 N7 名称/分区/类别/层数/容量
PASS  CD-01 N7 polygon 为规则占位多边形
PASS  CD-01 N1 名称/分区/类别/层数/容量
PASS  CD-01 N1 polygon 为规则占位多边形
PASS  CD-01 N2 名称/分区/类别/层数/容量
PASS  CD-01 N2 polygon 为规则占位多边形
PASS  CD-01 N11 名称/分区/类别/层数/容量
PASS  CD-01 N11 polygon 为规则占位多边形
PASS  CD-01 CN1 名称/分区/类别/层数/容量
PASS  CD-01 CN1 polygon 为规则占位多边形
PASS  CD-01 CN2 名称/分区/类别/层数/容量
PASS  CD-01 CN2 polygon 为规则占位多边形
PASS  CD-01 GYM 名称/分区/类别/层数/容量
PASS  CD-01 GYM polygon 为规则占位多边形
PASS  CD-01 LIB 名称/分区/类别/层数/容量
PASS  CD-01 LIB polygon 为规则占位多边形
PASS  CD-05 精度声明存在且含关键措辞
PASS  Junction 含 GATE3
PASS  §7.3 恰含 8 条路段且端点一致
PASS  CD-03 路段端点均存在于楼栋或 Junction 表
PASS  adjacency 与路段表一致
PASS  CD-03 路网连通，无孤立楼栋
PASS  动作目录 6 种
PASS  权重 1/3/2/2/1/1，总 10
PASS  duration_sim 45/60/30/20/25/35
PASS  critical 标记 A2/A3/A4
PASS  A4 前置：同楼栋 A3 已完成
PASS  A6 前置：有灾情标注且不可重复
PASS  A5 对象为路段
PASS  起始楼栋 N7，t_end=300
PASS  节点 30/45/60/70/80/90/100/110/130/140/150/220/250/300
PASS  t=90 为 disaster 核实事件（非上报），指向 N7
PASS  t=140 同时投放 U9 与 R-N7E 阻断事件
PASS  220/250 为推进回合（无事件）
PASS  上报投放节点照 §5.2
PASS  10 条上报，priority 为 1..10 的一个排列
PASS  CD-02 上报 building_id 均存在于楼栋表，locatable=false 时为 null
PASS  U1 双窗口 [30,90) 待核 / [90,null) 真报
PASS  U4/U5 locatable=false 且 building_id=null
PASS  U9 locatable=true 且 building_id=N7（路段不入楼栋字段）
PASS  每条窗口均含 reason
PASS  末回合排序答案 = priority 前三 {U2,U8,U4}
PASS  jia seq 连续递增
PASS  jia FR-4.7 全部操作 t_sim 均为节点值
PASS  jia 判读时上报已出现
PASS  jia 每条判读与所在窗口 expected 核对一致
PASS  jia 尝试序号按 动作+对象 连续
PASS  jia 完成时刻 = 提交 t_sim + duration_sim；被拒含原因
PASS  jia 被拒动作目标引用存在
PASS  jia 末回合 t=300 排序 {U2,U8,U4}
PASS  jia 甄别 80 复算一致
PASS  jia 响应 100 复算一致（起点 30，首个完成 75，差 45）
PASS  jia 命中 80 复算一致
PASS  jia 违规 70 复算一致
PASS  jia 总分 83 复算一致
PASS  yi seq 连续递增
PASS  yi FR-4.7 全部操作 t_sim 均为节点值
PASS  yi 判读时上报已出现
PASS  yi 每条判读与所在窗口 expected 核对一致
PASS  yi 尝试序号按 动作+对象 连续
PASS  yi 完成时刻 = 提交 t_sim + duration_sim；被拒含原因
PASS  yi 被拒动作目标引用存在
PASS  yi 末回合 t=300 排序 {U2,U8,U4}
PASS  yi 甄别 60 复算一致
PASS  yi 响应 0 复算一致（起点 30，首个完成 280，差 250）
PASS  yi 命中 50 复算一致
PASS  yi 违规 55 复算一致
PASS  yi 总分 44 复算一致
PASS  SC-01 分支甲 80/100/80/70 → 83
PASS  SC-02 分支乙 60/0/50/55 → 44
PASS  FR-4.7 t=100 回合内判读与动作混排且 t_sim 全为 100
PASS  SC-03 甲 + t=150 补做 A4（A3 已于 130 完成）→ 命中 100，总分 90
PASS  SC-03b 甲 + t=100 补做 A4 → 被拒，总分仍 83
PASS  SC-08 乙 A3 提前到 220 → 响应 ≈11.1，总分 46（不再 44）

全部通过
```

（退出码 0；首次运行曾因验证脚本自身的违规判定规则写错出现 5 项 FAIL，修正脚本后复跑全过，fixture 数值未改。）

类型检查（npm 直连 ECONNRESET，改用本机已有的 typescript 4.5.5，等效凭证）：

```
$ node C:/Users/ljh/AppData/Roaming/npm/node_modules/@vue/cli/node_modules/typescript/bin/tsc --noEmit --strict --target es2020 --module esnext --moduleResolution node src/contracts.ts
TSC_OK
```

（无输出即无类型错误，退出码 0。）

## 4. 结论与后续

（本节为 B 草案时期的结论，**已被 §6 冻结结果取代**。）B 侧契约草案与 fixture 完成，75 项检查全过，83/44/90/46 复算一致。**尚未冻结**：需 A 确认第 2 节列出的 7 处口径（尤其 cost 资源模型与 preconditions 编码），确认后更新本条目状态为 A+B。几何占位多边形待 A 确认或替换。83/44 仍非引擎输出，D4 才验证实时计算。

## 5. 待补凭证

- [ ] 用户补拍：本次 Qoder 对话截图（T1 指令与生成过程），存 `assets/D1-contracts-fixtures-chat-01.png`
- [ ] 用户补拍：A 确认契约的对话/消息截图（确认后），存 `assets/D1-contracts-fixtures-confirm-01.png`

## 6. 冻结结果（2026-11-17 追加）

A 推送 `e9d4a07`（契约 + fixture + DDL + 校验器 + 交接文档 `docs/handoff-d1.md`）。B 从 origin/main 逐条核对第 2 节 7 处口径，**全部由 A 基线解决，契约冻结**：

1. `start_building_id`：A 已有，一致。
2. Junction 坐标：A 不加 position 字段，路口位置由 `RoadSegment.geometry` 折线端点表达。B 草案字段废弃。
3. `UgcReport.text`：A 已有，另含 `category` 五类与 `is_training: 1`。
4. preconditions：采纳 A 编码 `{ type, action_id?, description }`，5 种 type。
5. 资源模型：A 定义 `ActionDef.resource_id / resource_units` + `scenario.resources` + `ResourceUsage` 占用区间；B 的 `cost: {}` 占位废弃。
6. `critical_items`：A 为 `StandardActionItem[] { action_id, target_id, label }`。
7. breakdown/payload：采纳 A 的 `ScoreResult.details + sorting?` 与 verdict/action/sort 三类流水（`supersedes_seq`、`reject_reason_code` 等）。

合并操作：B 草案提交留档于侧分支 `b/d1-contracts-draft`（`2599f0d`），main 快进至 `e9d4a07`；B 的 `scripts/verify-fixtures.mjs` 不进 main（A 的 `scripts/validate-canonical.ts` 覆盖更全）。本条目第 3 节的 75 项输出为 **B 草案时期**的历史凭证，保留不改。

B 独立复核（npm 持久代理已设为 Clash 混合端口 `http://127.0.0.1:7897`；`npm install` 成功后运行 A 的校验器，退出码 0）：

```
$ npm install
added 6 packages, and audited 7 packages in 33s
found 0 vulnerabilities

$ npm run check:d1
> campus-emergency-drill@0.1.0 check:d1
> npm run typecheck && npm run validate

> campus-emergency-drill@0.1.0 typecheck
> tsc --noEmit

> campus-emergency-drill@0.1.0 validate
> tsx scripts/validate-canonical.ts

D1 canonical fixture validation PASSED
buildings=8 junctions=1 roads=8 reports=10 actions=6 runs=3
run-jia-1x [甲] 甄别=80 响应=100 命中=80 违规=70 总分=83 | 响应 45s, 违规 2 次, 缺项 1
  sort U2,U8,U4 | correct=true | response action seq=1
run-yi-1x [乙] 甄别=60 响应=0 命中=50 违规=55 总分=44 | 响应 250s, 违规 3 次, 缺项 4
  sort U2,U8,U4 | correct=true | response action seq=16
run-jia-plus-a4 [甲补做A4] 甄别=80 响应=100 命中=100 违规=70 总分=90 | 响应 45s, 违规 2 次, 缺项 0
  sort U2,U8,U4 | correct=true | response action seq=1
clock_checks: 1× = 45s, 4× = 45s (模拟时刻 30 → 75 固定)
quality cases: SC-03 / SC-03b / SC-04 / SC-05 / SC-07 / SC-08 通过
```

**结论：契约双方冻结成立。** 83/44/90 在 A 基线上由 B 独立复跑确认；1×/4× 响应恒为 45 模拟秒。注意：这仍是 fixture 静态对照，实时评分待 D4 引擎交付后验证（Q6）。