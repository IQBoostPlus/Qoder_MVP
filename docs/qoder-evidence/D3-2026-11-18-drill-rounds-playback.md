# D3 · 2026-11-18 · 推演页布局 + 回合状态机/时间轴 + 控速播放 + 分批投放 + 回合内自由行动时机框架

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F3 回合推进/时间轴、F4 道路双状态（复用）、FR-4.1 可见性、FR-4.7 时机不变量、FR-8.3 模式入口区分、TC-01～07、VS-01/VS-04、RE-06/RE-07（渲染侧）、T5 无障碍、Q3/Q7/Q10、CD-04 |
| 状态 | 已完成（B 侧 32 项全部实测）；动作合法性/拒绝/评分真实判定待 A 规则引擎（D3 未落地）；完整动作面板/判读改判窗反馈/末回合排序交互/实时评分属 D4，本日只做时机框架与门控占位 |

## 1. 想完成什么

D3 B 轨交付（排期表 D3 · B）：新建独立「推演舱」DrillView（区别于 MapView 示例回放），以 `scenario.nodes`（14 节点 n030…n300）驱动回合状态机与时间轴 UI，不硬编码任何节点时刻；1×/4× 控速播放只压缩**真实等待**（不改 t_sim/duration_sim、不复制流水）；分批投放按 `visibleReportsAt` 做差（`lastBatch`），展示集合随回合可见性回退（FR-4.1/VS-01）；回合内自由行动**时机框架**——所有操作 stamp 恒等于当前回合 t_sim（FR-4.7），临时动作提交消费 A 规则引擎或显式「待引擎接入」占位，绝不 fabricate 通过/拒绝/分数；排序入口仅末回合开放（VS-03 门控占位，交互属 D4）；375px + 双主题 WCAG AA + 键盘可达。

**边界**：只消费 `port.map` / `replayTo` / `visibleReportsAt` / `windowAt` / `getScore(runId, currentEvents)` / `getRoute`，不实现 Dijkstra/规则引擎/评分器/违规统计。A 的 D3 规则引擎本地未落地（git fetch 失败，无引擎文件）→ 按提示词 §5.4 **做法 2**：fixture 骨架 + 「待引擎接入」占位；地图/图层/道路/占用由 `replayTo(skeletonRunId, {t_sim})` 驱动并全程徽标「fixture 骨架演示 / 非临场引擎结果」；本地账本只记录学员操作，pending 动作不声称 accepted/rejected/已完成；`currentEvents` 仅含判读 + 引擎确认动作（排除 pending），推演内 `getScore` 恒 null → `SCORE_PENDING_TEXT`。动作消费签名以**待协商**提案记录（§4）。

## 2. 在 Qoder 中做了什么

- 对话截图：待用户补拍（见 §5）。
- 按提示词 `prompt/D3-B-drill-rounds-playback.md` §14 顺序执行：复跑 `check:d1-v2` 基线 → 回合配置/状态机 composable → DrillView 布局/时间轴/控速 → 分批投放/可见性 → 动作时机框架/账本 → 排序门控 → 诊断台时机断言 → 375px/双主题对比度 → 逐项验收 → 凭证。
- 新建 [`src/config/rounds.ts`](../../src/config/rounds.ts)：`deriveRounds(scenario)` 从 `scenario.nodes` 派生 14 回合，`kind` 由 `t_sim===t_end→'final'`、`events.length===0→'advance'`、否则 `'event'` 判定（无时刻字面量）；`ROUND_KIND_LABEL`（事件/推进/末回合）、`DRILL_MODE_BADGE='fixture 推演 · 实时评分待 D4'`、`DRILL_SKELETON_BADGE='fixture 骨架演示'`、`ENGINE_PENDING_LABEL='待引擎接入'`。
- 新建 [`src/composables/useDrillRound.ts`](../../src/composables/useDrillRound.ts)（~294 行）：回合状态机（roundIndex/currentRound/currentT/canPrev/canNext/sortOpen）、`goToRound/goToTime/nextRound/prevRound`（jumpTo 落在首个 ≥ 目标的回合）、控速 `togglePlay`（interval=`ROUND_BASE_WAIT_MS(4000)/speed`，只压缩真实等待）、真实用时计时（`performance.now`+500ms tick，独立于 T+{t_sim}s，不计分）、`submitVerdict`（含改判 supersedes）、`submitAction`（校验 target_kind via port.map，attempt=count+1，judge 钩子或 pending 占位）、`currentEvents`（判读+引擎确认动作，排除 pending）、`resetDrill`。导出 `ActionJudge`/`ActionSubmissionInput`/`PendingActionSubmission`/`LedgerEntry`/`pendingActionText(sub,tSim)`。**可见性修复**：`deliveredReports = computed(() => port.visibleReportsAt(currentT))`（随回合回退，FR-4.1/VS-01）；`deliveredIds` 单调 Set 仅用于做差投放（lastBatch）与判读守卫，不决定展示。
- 新建 [`src/views/DrillView.vue`](../../src/views/DrillView.vue)：推演舱布局（地图舞台 + 信息轨），时间轴 14 tick（当前/已过/未来三态 + 回合类型标签）、回合控制（上一/下一/播放/倍速 1×4×/跳转）、`sec-roundctl` 常驻（窄屏可读回合信息）、账本表 5 列（seq/类型/对象/时刻/状态）、上报卡（仅 id/appears_at/text + 训练模拟数据徽标，不泄漏 category/event_truth/priority/judgment_windows）、判读 select（真报/误报/待核）+ 定位 select（""+8 楼栋+无法定位，JW-09）+ 记录判读、分批横幅 `#batch-banner`、排序门控 `#sort-entry :disabled=!sortOpen` + 占位说明、6 页签（回合/上报/道路/路径/图例/评分）。统计行「可见 N/10 · 本回合新增 M · 真实用时 Xs（不计分）」。
- 改 [`src/components/ObjectDetail.vue`](../../src/components/ObjectDetail.vue)：可选 `actions` prop + 动作 select（aria-label="选择处置动作"）+「提交动作（临时）」按钮（复用 D2 详情面板，不另起炉灶）。
- 改 [`src/App.vue`](../../src/App.vue)：默认 tab='drill'；模式入口徽标区分（drill→`#badge-drill` DRILL_MODE_BADGE、map→`#badge-replay` 示例回放、diag→`#badge-diag` 构造/合成数据，全局 `#badge-training` 训练模拟数据）；`watchEffect` 同步 `document.title` 至 modeTitle（修掉切页标题滞留）。
- 扩 [`src/views/DiagnosticView.vue`](../../src/views/DiagnosticView.vue) 至 11 面板：新增 `#panel-timing`「D3 时机不变量断言」（徽标「测试断言 · 非临场引擎」，`#run-timing` 按钮 + `#timing-table` 8 行：TC-01/02 倍速响应一致、TC-03 真实等待+500ms 评分恒 null、TC-04 在途→完成、TC-06 stamp 恒等、TC-07 推进回合可行动、FR-4.7 stamps⊆nodes、VS-01/04 可见性、RE-渲染侧构造拒绝保留+渲染）。顶层构造 `rejectJudgeStub: ActionJudge`（返回 rejected/PRECONDITION_NOT_MET）+ `drillRejectProbe = useDrillRound(..., {judgeAction})`（setup 顶层创建，getCurrentInstance 非空 → onUnmounted 清计时器，避免泄漏）；resetAll 纳入 drillRejectProbe.resetDrill。
- 改 [`src/styles/console.css`](../../src/styles/console.css)：D3 块（时间轴 tick/回合控制/账本/上报卡/分批横幅/排序门控）全部复用 token；窄轨账本修正 `#ledger-table td.wrap{min-width:0}` + `td:last-child{min-width:88px;white-space:normal}`（修掉状态列逐字竖排）；≤900 媒体查询 `.deck-main{overflow-y:auto}`（上下分栏纵向滚动）、`.rail{height:auto;overflow:visible}`、`.rail-sec{display:none}` 例外 detail/situation/roundctl + 活动页签、`.hud-tl .hud-line` 隐藏（回合信息在 sec-roundctl 可读）；≤400 补换行。
- 人工修正：① 切页 document.title 滞留 → watchEffect 同步；② 窄轨账本状态列挤成逐字竖排 → min-width 修正后状态格 119px、~4 行可读、无横向滚动；③ **真实可见性 bug**：原 `visibleReportsAt(tEnd).filter(deliveredIds)` 在回 scrub 到早期回合时泄漏未来线索（t=30 仍显 U3/U2），违反 FR-4.1/VS-01 → 改 `visibleReportsAt(currentT)`，统计行「已投放」改「可见」绑 deliveredReports.length，移除未用 deliveredIds 解构；回退 t=30 实测仅 U1、可见 1/10、横幅隐藏（不重复播报）；④ 构造探针在事件处理器内创建会泄漏 500ms realTimer → 移至 setup 顶层。

## 3. 如何验证

### 3.1 CLI 基线（完整命令与输出）

```
$ npm run typecheck
> tsc --noEmit
EXIT=0

$ npm run typecheck:app
> vue-tsc --noEmit -p tsconfig.app.json
EXIT=0（无 ! 断言 / as any / ts-ignore / ts-expect-error / @ts-nocheck；strict + noUncheckedIndexedAccess 未放宽）

$ npm run build
> vue-tsc --noEmit -p tsconfig.app.json && vite build
✓ 47 modules transformed
✓ built（dist 产物生成，无报错）

$ npm run check:d1-v2
> npm run check:d1 && tsx scripts/validate-d1-v2.ts
score: jia 83; yi 44; jia-plus-a4 90（契约值未动）
replay/rejections/route/1x-4x response 全过
EXIT=0
```

83/44/90 契约值未动；A 冻结文件（contracts.ts / fixture-port.ts / fixtures/*.json / schema.sql / validate-*.ts）零改动；MapView 示例回放未改（D2 回归截图 d3-d2-regression-map.png）。

### 3.2 §11 逐项实测（浏览器实操，Chrome via Qoder Browser Connector，dev server http://127.0.0.1:5173/；32 项全过）

| # | 验收项 | 结果 | 证据/实测值 |
| --- | --- | --- | --- |
| 1 | check:d1-v2 全过，83/44/90 不变 | ✅ | §3.1，EXIT=0 |
| 2 | typecheck + typecheck:app 通过，无 ! 蒙混 | ✅ | §3.1 双 EXIT=0；代码扫描无 as any/ts-ignore/! 断言 |
| 3 | build 成功 | ✅ | 47 modules，dist 生成 |
| 4 | 控制台 0 error / 0 rejection（桌面+移动） | ✅ | 全程 sweep 后 list_console_messages 仅 vite debug（connecting/connected/hot updated），0 error 0 warning |
| 5 | 推演舱独立入口，区别于示例回放 | ✅ | 默认 tab=drill；#badge-drill「fixture 推演 · 实时评分待 D4」vs map #badge-replay「示例回放」vs diag #badge-diag「构造/合成数据」 |
| 6 | 14 回合由 scenario.nodes 派生，无硬编码时刻 | ✅ | deriveRounds 读 nodes；rounds.ts/useDrillRound.ts/DrillView.vue 扫描无节点时刻字面量（30/45/…/300） |
| 7 | 回合类型：事件/推进/末回合正确 | ✅ | 220/250 events=[]→advance；300 events=[]+t_end→final；其余 event；时间轴标签实测一致 |
| 8 | 时间轴当前/已过/未来三态 + 跳转 | ✅ | tickCurrent/tickNormal 对比度区分；goToTime 落首个 ≥ 目标回合 |
| 9 | 上一/下一回合导航 + 边界禁用 | ✅ | canPrev/canNext 首末回合禁用；press_key Space 真实激活 #round-prev（4→3） |
| 10 | 1×/4× 控速只压缩真实等待 | ✅ | 4× 2 回合/2303ms vs 1× 0 回合/2302ms；interval=4000/speed |
| 11 | 倍速不改 t_sim/duration_sim、不复制流水 | ✅ | TC-01/02 两速时钟均 45s、账本逐条相同（diag #timing-table） |
| 12 | 真实用时计时独立、不计分 | ✅ | performance.now+500ms tick；统计行「真实用时 Xs（不计分）」与 T+{t_sim}s 分离 |
| 13 | 分批投放按 visibleReportsAt 做差 | ✅ | lastBatch 仅本回合新增；TC-07 推进回合 220 新增 0 |
| 14 | 展示集合随回合可见性回退（FR-4.1/VS-01） | ✅ | t=60 显 [U1,U3,U2]；回退 t=30 仅 U1、可见 1/10、横幅隐藏；截图 d3-vs01-t60-reports.png |
| 15 | VS-04 末回合全 10 条可见 | ✅ | t=300 可见 10/10 |
| 16 | 上报卡不泄漏内部字段 | ✅ | 仅 id/appears_at/text + 训练模拟数据徽标；无 category/event_truth/priority/judgment_windows |
| 17 | 判读提交 stamp 恒等当前 t_sim（FR-4.7） | ✅ | TC-06 stamps=[100×5]；FR-4.7 stamps⊆nodes |
| 18 | 判读改判 supersedes 记录 | ✅ | 账本「改判 · 覆盖 seqN」；截图 d3-ledger-verdict-supersedes.png |
| 19 | 定位候选 = 楼栋 + 无法定位（JW-09） | ✅ | select 8 楼栋 + 无法定位；路段/路口不在其中 |
| 20 | 动作提交 stamp 恒等当前 t_sim | ✅ | TC-06 动作 stamp=当前回合；submitted_at_sim 恒 30（TC-04） |
| 21 | 无引擎时动作显式「待引擎接入」占位 | ✅ | pendingActionText「待引擎接入 · 预计完成 @75」/「…时刻已到 @75」；不声称 accepted/rejected |
| 22 | TC-04 在途→完成（骨架基线，标注） | ✅ | t=30 账本「预计完成@75」在途；t=80「预计完成时刻已到@75」；骨架基线「在途→已完成@75」徽标 fixture 骨架演示；截图 d3-tc04-ledger-t30-intransit.png / d3-tc04-ledger-t80-completed.png |
| 23 | 引擎确认动作的拒绝渲染（构造桩验证渲染侧） | ✅ | RE-渲染侧：status=rejected · code=PRECONDITION_NOT_MET · attempt=1 · 渲染「已拒绝 · PRECONDITION_NOT_MET 需同楼 A3 已完成（构造桩）」；currentEvents 含 action；真实判定待 A |
| 24 | currentEvents 排除 pending，getScore 恒 null | ✅ | TC-03 真实等待+500ms 评分恒 null→SCORE_PENDING_TEXT；pending 不入 currentEvents |
| 25 | 推进回合（220）仍可行动 | ✅ | TC-07 新增 0、已投放 10→10、stamp 220、advance 可提交动作 |
| 26 | 排序入口仅末回合开放（VS-03 门控） | ✅ | #sort-entry :disabled=!sortOpen；非末回合禁用；末回合开放 + 占位说明「完整交互属 D4」；截图 d3-round-last-sort-open.png |
| 27 | 地图/图层/道路/占用由骨架快照驱动 + 徽标 | ✅ | replayTo(skeletonRunId,{t_sim})；「fixture 骨架演示 / 非临场引擎结果」徽标常驻 |
| 28 | 375px 无横向滚动 + 触控 ≥44 | ✅ | scrollWidth=375；按钮 88×44、倍速 58×44、tick 48×44、排序 315×44；上下分栏纵向滚动；截图 d3-375-drill.png / d3-375-drill-roundctl.png |
| 29 | 双主题 WCAG AA（≥4.5） | ✅ | §3.3 两表全过；焦点环 ops 2px rgb(255,178,36) / daylight 2px rgb(122,84,0) |
| 30 | 键盘可达 + 焦点环两主题 | ✅ | press_key Tab/Space 真实 :focus-visible；select/button tabindex；Esc 清除（复用 D2） |
| 31 | 页脚声明 + 徽标同屏 | ✅ | PRECISION_NOTICE 页脚 + 训练模拟数据/骨架徽标同屏；截图 d3-desktop-drill-panorama.png |
| 32 | D2 示例回放无回归 | ✅ | MapView 未改；截图 d3-d2-regression-map.png；check:d1-v2 仍全过 |

### 3.3 双主题对比度实测（window.__ratio：rgba 沿祖先背景链 alpha 合成；SVG 读 fill）

**ops（夜航）主题** — 全部 ≥4.5：

| 元素 | 比值 | 元素 | 比值 |
| --- | --- | --- | --- |
| tickCurrent | 8.42 | reportId | 16.93 |
| tickNormal | 7.24 | reportText | 16.93 |
| tickKind | 7.24 | reportAt | 7.63 |
| drillBadge | 7.60 | reportBadge | 5.79 |
| trainingBadge | 5.79 | ribbonText | 16.93 |
| skeletonBadge | 7.03 | roundNowT | 10.37 |
| roundStats | 7.24 | roundNowLabel | 16.06 |
| batchBanner | 8.42 | sortBtn | 14.02 |
| occLabel | 16.93 | sortNote | 7.24 |
| occStateBadge | 9.07 | ledgerState | 13.04 |
| ledgerDetail | 16.06 | ledgerStamp | 13.04 |
| ledgerHead | 9.05 | ledgerSeq | 16.06 |
| ledgerType | 16.06 | | |

**daylight（日光）主题** — 全部 ≥4.5：

| 元素 | 比值 | 元素 | 比值 |
| --- | --- | --- | --- |
| tickCurrent | 5.31 | reportId | 13.30 |
| tickNormal | 5.29 | reportText | 13.30 |
| tickKind | 5.29 | reportAt | 5.01 |
| drillBadge | 5.81 | reportBadge | 5.25 |
| trainingBadge | 5.92 | ribbonText | 13.30 |
| skeletonBadge | 5.42 | roundNowT | 6.12 |
| roundStats | 5.29 | roundNowLabel | 14.04 |
| batchBanner | 5.31 | sortBtn | 12.51 |
| occLabel | 13.30 | sortNote | 5.29 |
| occStateBadge | 5.05 | ledgerState | 12.18 |
| ledgerDetail | 14.04 | ledgerStamp | 12.18 |
| ledgerHead | 5.45 | ledgerSeq | 14.04 |

焦点环：ops `2px solid rgb(255,178,36)`；daylight `2px solid rgb(122,84,0)`（:focus-visible 真实键盘触发）。

### 3.4 截图清单（docs/qoder-evidence/assets/）

| 文件 | 内容 |
| --- | --- |
| d3-desktop-drill-panorama.png | 推演舱桌面全景（回合 1，页脚声明 + 徽标同屏） |
| d3-desktop-drill-daylight.png | 日光主题推演舱 |
| d3-diag-timing-assertions.png | 诊断台 #panel-timing 8 行断言全绿 |
| d3-round-last-sort-open.png | 末回合排序入口开放 + D4 占位说明 |
| d3-tc04-ledger-t30-intransit.png | TC-04 t=30 在途「预计完成@75」 |
| d3-tc04-ledger-t80-completed.png | TC-04 t=80「预计完成时刻已到@75」+ 骨架基线已完成 |
| d3-vs01-t60-reports.png | VS-01 t=60 可见 [U1,U3,U2] |
| d3-ledger-verdict-supersedes.png | 判读改判 supersedes 账本 |
| d3-375-drill.png | 375px 推演舱（无横向滚动） |
| d3-375-drill-roundctl.png | 375px 回合控制常驻可读 |
| d3-d2-regression-map.png | D2 示例回放无回归 |

### 3.5 代码扫描 / 冻结边界

- `git status --short` + `git diff --stat`：仅 App.vue / ObjectDetail.vue / console.css / DiagnosticView.vue 修改 + useDrillRound.ts / rounds.ts / DrillView.vue 新建 + 11 截图；**A 冻结文件零改动**，MapView 未改。
- package.json 运行时依赖仅 vue（无新依赖）；tsconfig strict + noUncheckedIndexedAccess = true 未放宽。
- 扫描无 `as any` / `ts-ignore` / `ts-expect-error` / `@ts-nocheck` / 非空 `!` 断言；impl 无硬编码楼栋 id/名称/坐标/校园 viewBox（图标 `viewBox="0 0 16 16"` 为图形非校园坐标）；rounds.ts/useDrillRound.ts/DrillView.vue 无节点时刻字面量。
- 空态/声明文案全部 import 常量（ROUTE_PENDING_TEXT/ROUTE_UNREACHABLE_TEXT/SCORE_PENDING_TEXT/PRECISION_NOTICE），未另写。

## 4. 结论与后续

**达成**：D3 B 侧 32 项全部实测通过，check:d1-v2 基线 83/44/90 未动，双主题 AA、375px、键盘可达均实测。回合状态机/时间轴/控速/分批投放/可见性回退/时机不变量/排序门控/动作时机框架已落地。

**B 已实测 vs 待 A vs 待 D4（诚实分离，不夸大）**：
- **B 已实测**：回合派生与类型、时间轴三态/跳转、1×4× 只压缩真实等待（TC-01/02/03）、分批做差与可见性回退（VS-01/04、TC-07）、FR-4.7 stamp 恒等（TC-06）、判读改判 supersedes、排序末回合门控（VS-03）、375px/双主题/键盘、骨架快照驱动 + 徽标、D2 无回归。
- **待 A（规则引擎 D3 未落地）**：动作真实合法性判定、拒绝原因码、资源占用、完成时刻、实时评分。本日按 §5.4 做法 2 用 fixture 骨架 + 「待引擎接入」占位；拒绝渲染仅以**构造桩**在诊断台验证渲染侧（RE-渲染侧），不冒充真实判定；推演内 getScore 恒 null。
- **待 D4（本日只做框架/门控，未实现）**：完整动作面板拒绝细化、判读改判窗反馈 UI、末回合排序完整交互与提交、实时评分里程碑。排序入口仅门控占位，账本「已完成」仅来自标注的骨架基线。

**与 A 协商的动作消费签名（待协商提案）**：
```ts
type ActionJudge = (input: {
  action_id: string; target_id: string; submitted_at_sim: number;
}) => ActionAttempt | null;
```
B 侧负责分配 seq/attempt 并追加账本；返回 `null` → pending「待引擎接入」占位；返回 `ActionAttempt` → 按 status/reject_reason_code/resource_usage 渲染并纳入 currentEvents。契约 `ActionAttempt.status` 仅 'accepted'|'rejected'（无 'pending'），故 pending 用独立 `PendingActionSubmission` 类型承载，不污染契约。**此签名待 A 确认**；A 引擎落地前 B 不发明判定逻辑。

**§10 十陷阱规避**：① 不硬编码节点时刻（deriveRounds 读 nodes）；② 倍速不当另一条流水/不复制 4× 记录（TC-01/02 账本逐条相同）；③ 倍速不改 t_sim/duration_sim；④ 展示集合随可见性回退（修掉未来线索泄漏）；⑤ pending 不声称 accepted/rejected/已完成；⑥ currentEvents 排除 pending、getScore 第二参数恒带、偏离不回退基线分；⑦ 定位候选不含路段/路口（JW-09）；⑧ 排序仅末回合门控、不提前实现 D4 交互；⑨ 骨架全程徽标「非临场引擎结果」、不冒充真实判定；⑩ 模式入口徽标区分推演/示例回放/诊断（Q10/FR-8.3）。

**新发现缺口**：A 的 D3 规则引擎本地未落地（git fetch 失败，Clash 未启动），动作真实判定/评分链路待 A 推送后接入；ActionJudge 签名待协商。预置路径缺失（getRoute 恒 null）仍为跨轨待决项（沿用 D1/D2 记录）。

## 5. 待补凭证

- [ ] 用户手动补拍：D3 推演舱开发对话截图（回合状态机/控速指令与生成结果）→ `assets/d3-drill-rounds-playback-chat-01.png`
- [ ] 用户手动补拍：D3 可见性 bug 修复对话截图（FR-4.1/VS-01 回退）→ `assets/d3-drill-rounds-playback-chat-02.png`
- [ ] 用户手动补拍：D3 诊断台时机断言对话截图 → `assets/d3-drill-rounds-playback-chat-03.png`