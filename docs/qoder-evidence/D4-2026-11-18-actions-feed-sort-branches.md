# D4（B 侧提前开工）· 动作面板 + 信息流 + 末回合排序 + 双分支对照

- 日期：2026-11-18（排期 D4 = 11/21；B 侧可独立完成部分提前落地）
- 责任人：B（界面侧）
- 前置核实：`git fetch` 后 origin/main 仍 `d806ba3` —— **A 的 D3 规则引擎与 D4 评分器尚未交付**。故本轮只做 B 侧不依赖引擎的完整交互壳，合法性/计分保持「待引擎接入」，不伪造。

## 1. 想完成什么

D4 B 范围：动作面板、信息流、甄别与改判、末回合排序、同剧本双分支里程碑。其中甄别/改判 D3 已具备（含 supersedes 覆盖展示），本轮补齐其余四项的可交互实现，并把「实时评分/合法性」明确留待 A 同步点。

## 2. 在 Qoder 中做了什么

- `useDrillRound`：新增 `LedgerEntry kind:'sort'`、`submitSort(orderedIds)`（FR-4.4/VS-03 仅末回合；顺序须恰为当前可见上报全集、无重复；stamp=当前节点）、`currentEvents` 纳入 sort、导出 `submitSort`/`actionAttemptCount`。
- `DrillView`：
  - 新增 dock「动作」「信息流」。
  - **动作面板 R4**：6 张动作卡（id/名称/关键标记/时长/对象类型/前置条件描述），对象下拉（楼栋或路段，按 target_kind），提交→pending 占位；尝试次数；pending 表与 confirmed 表（拒绝原因列只读引擎结果）。
  - **信息流 R5**：投放（ugc_reports.appears_at_sim）+ 路况（hazard/封闭，双态不合并）+ 学员操作（判读/动作/排序）合并时间线，按 stamp 排序；过滤 chips 全部/投放/判读/动作/排序/路况；自定义滚动条。
  - **末回合排序 R3c**：sortOpen 时渲染全部可见上报（10 条）可重排列表（↑↓ + 位次徽标），提交/改排重提；显示已提交顺序 + 「计分待引擎接入」；非末回合保持门控文案。替换 D3 占位。
  - **双分支对照 R8b**：甲/乙/甲补做A4 各分支完整标准流水 `getScore` → 83/44/90，标签「示例回放 · 非临场」；临场评分仍 null → 待接入常量，不回退基线。
  - `resetDrill` 同步清空 sortOrder/actionTarget/feedFilter。
- `console.css`：D4 组件样式（动作卡/排序列表/信息流/分支对照/chips/ btn-sm / cell-green），移动端 dock 显示规则补 actions/feed。

## 3. 如何验证（真实浏览器 + CLI）

| 项 | 结果 |
| --- | --- |
| 动作卡 | 6 张；A2 选「萃园7幢」提交 → 账本 seq1 pending「待引擎接入 · 预计完成 @90」 |
| 信息流 | 初始 2 行（投放+动作）；末回合后 14 行；过滤「判读」记录判读后 =1 |
| 末回合排序 | t300 列表 10 条；↑↓ 重排 → 提交 `U2 > U8 > U4 > …`（与 expected_sort 前三一致）；改排重提覆盖；账本 sort 行 @300 |
| 评分不回退 | 提交排序/判读后临场评分仍「实时评分待引擎接入」（null），分支对照 83/44/90 |
| 重置 | 账本 0 行、sort-last 消失、信息流回到初始投放 |
| 375px | dock「动作」「信息流」切换 display:flex；chips 可见；6 卡单列；无横向溢出 |
| console | 0 error（仅 vite debug） |
| 门禁 | `typecheck:app` / `build` / `check:d1-v2`（甲83·mutation=>null·硬编码扫描 clean）/ `check:d2` PASSED |

## 4. 诚实边界

- **动作合法性与拒绝原因、资源容量校验、排序计分、临场四指标评分**均待 A 的 D3 规则引擎 / D4 评分器；本轮一律 pending 占位，未伪造 accepted/rejected/分数。
- 双分支 83/44/90 为**标准样例回放**对照（示例回放标签），不是临场实时计算；「实时计算里程碑」在 A 评分器接入后关闭。
- 结果截图待内置浏览器面板可见后补拍；对话截图由用户补。
- 排序交互为 ↑↓ 按钮（无拖拽），满足可操作与可访问；拖拽属增强非必需。

## 5. 凭证

- CLI：`d1-v2-local-validation.log` / `d2-routing-validation.log` 复跑一致；本轮复核 `check:d2` EXIT=0、`typecheck:app` EXIT=0、`build` 50 modules 成功。
- 截图：已补拍（见 §6.4）。对话截图由用户补。

## 6. 复核补记（2026-11-18，独立浏览器复核 + 一处桌面缺陷修复）

本节为对 §3 的独立复核（Chrome via Qoder Browser Connector，dev server http://127.0.0.1:5173/），并记录复核中发现并修复的一处桌面布局缺陷。§3 各项结论复核后成立。

### 6.1 §3 逐项复核实测

| 项 | 复核实测 |
| --- | --- |
| 动作卡 | 6 张；A2 选 N7（萃园7幢）提交 → 账本 seq1 stamp30「待引擎接入 · 预计完成 @90」；尝试计数 1；pending 表 seq/动作/对象/提交/状态 五列 |
| 信息流 | 初始 1 行（投放 U1）；提交 A2 后 2 行（投放+动作）；记录 U1 判读后过滤「判读」=1 行；chips 全部/投放/判读/动作/排序/路况 六枚 |
| 末回合排序 | t300 列表 10 条 + 位次徽标 1～10；↑↓ 重排得 U2>U8>U4>…（与 expected_sort 前三一致）；提交 → 账本 seq3 @300「已提交 · 计分待引擎接入」+ sort-last 全序；改排重提 → seq4 @300、sort-last 更新为最新序 |
| 评分不回退 | 提交动作/判读/排序后临场评分恒「实时评分待引擎接入」（null）；分支对照 甲83/乙44/甲补做A490（示例回放标签） |
| 重置 | 账本 0 行、sort-last 消失、sort-entry 重新禁用、回合回 1/14、A2 对象清空、feedFilter 回全部、信息流回 1 行 |
| 375px | 同源 iframe 真实媒体查询：dock「动作」「信息流」display:flex；6 卡单列 315px；chips 6 枚可见（24px，WCAG 2.2 AA 最小目标）；docScrollW=375 无横滚；deck-main overflow-y:auto |
| console | 全程仅 vite debug（connecting/connected/hot updated），0 error 0 warning |
| 门禁 | check:d2 / typecheck:app / build 复跑全过（83/44/90 未动） |

### 6.2 发现并修复：桌面动作卡横向溢出

- **缺陷**：`.action-cards` 原 `grid-template-columns: 1fr 1fr`（console.css:1064），在 ~374px 信息轨内两个 min-content 轨道合计 592px → 卡片被裁切、rail scrollWidth 607 > clientWidth 374、pending 表横向滚动。§3 只验了 375px 单列，未覆盖桌面窄轨。
- **修复**：改 `repeat(auto-fit, minmax(min(100%, 260px), 1fr))` + `.action-card{min-width:0}` + `.action-head{flex-wrap:wrap}` + `.action-name{min-width:0}`；并加 `.sec-actions .data td{white-space:normal}` / `td.wrap{min-width:0}` 修表格换行。
- **复测**：cardsCols=340px 单轨、cardsScrollW=340=clientW、railScrollW=374=clientW、tblScrollW=338=clientW、docScrollW=1477=viewport，横向溢出消除；6 卡单列完整可读。

### 6.3 D4 新增组件双主题对比度（window.__ratio，alpha 合成）

**ops** — 全 ≥4.5：action-id 9.68 / action-name 14.99 / action-dur 6.76 / action-pre 6.76 / action-count 6.76 / action-select 16.06 / badge-red(关键) 5.02 / feed-t 9.68 / feed-kind 6.76 / feed-text 14.99 / branch-name 14.99 / branch-id 6.76 / branch-total 9.68 / chip 10.93 / chip.on 10.93 / sort-pos 10.93 / sort-id 9.68 / sort-text 14.99 / sort-btn 14.02 / sort-submit 14.02 / 表 cell-amber 13.04。

**daylight** — 全 ≥4.5：action-id 5.47 / action-name 12.55 / action-dur 4.73 / action-pre 4.73 / action-count 4.73 / action-select 14.04 / badge-red 4.96 / feed-t 5.47 / feed-kind 4.73 / feed-text 12.55 / branch-name 12.55 / branch-id 4.73 / branch-total 5.47 / chip 5.80 / chip.on 5.80 / sort-pos 5.80 / sort-id 5.47 / sort-text 12.55 / sort-btn 12.51 / sort-submit 12.51 / 表 cell-amber 12.18。

### 6.4 截图清单（docs/qoder-evidence/assets/）

| 文件 | 内容 |
| --- | --- |
| d4-action-panel-pending.png | 桌面推演舱全景 + 账本 A2 pending 行 |
| d4-action-cards.png | R4 动作面板单列 6 卡（修复后）+ A2 尝试 1 次 |
| d4-feed-merged.png | R5 信息流合并时间线 + 过滤 chips |
| d4-sort-final-submitted.png | 末回合 10 条重排 + 已提交序 + 计分待引擎接入 |
| d4-375-feed.png | 375px 信息流页签 |
| d4-375-actions.png | 375px 动作页签单列 + 页脚声明 |
| d4-daylight-actions.png | 日光主题动作面板 |

### 6.5 诚实边界复核

- 动作合法性/拒绝/资源/排序计分/临场四指标仍待 A；本轮复核确认界面一律 pending 占位，未伪造 accepted/rejected/分数；临场 getScore 恒带账本第二参数且偏离→null。
- 双分支 83/44/90 为**标准样例回放对照**（示例回放标签），非临场实时计算；实时计算里程碑待 A 评分器接入后关闭。
- A 的 D2 路由已落地（check:d2 中 RE-06 真实 Dijkstra 改道：t=139 直达 120px → t=140 经 N1 660px），故 D3 记录中「getRoute 恒 null」已过时；但 D3 规则引擎/D4 评分器仍未交付，动作判定保持占位。