# D4 B 轨验收复验 · 2026-11-19（验收单 1–70 逐条实测 + 缺口补齐）

责任人：B（界面侧）。配套：[`prompt/D4-acceptance-checklist.md`](../../prompt/D4-acceptance-checklist.md)、[`prompt/D4-B-live-scoring-sort-review.md`](../../prompt/D4-B-live-scoring-sort-review.md)。
本条目是 B 轨当日**第二次独立运行**（第一次见 [`D4-2026-11-19-b-independent-signoff.md`](D4-2026-11-19-b-independent-signoff.md)），
按 §0.4「复核 + 补齐 + 逐条验收」执行：不 rollback/重写既有实现，70 项全部以**本会话自己的测量**填单，A 列保持待测。

## 1. 想完成什么

1. 对合并后基线（A `ea7c9de` → `9775ccc`）上的 B 集成改动做逐条验收（验收单 1–70），每格填实测数值/文案/计数。
2. 里程碑一正一反：甲补做 A4@150 → 90；甲补做 A4@100 → 被拒仍 83（Q6 / SC-01～03b）。
3. 补齐复核中发现的 B _scope 缺口：375px 触控目标（动作提交 26px、chip 23px）、Q7 页面水印、CD-04 空态文案硬编码节点时刻。
4. 修复后复跑闸门（check:d4 / typecheck / typecheck:app / build），并通过**生产 preview** 复测，避免 dev 缓存污染测量。
5. 留存凭证、更新索引与质量文档、填验收单 B 列，列出待 A / 待 D5+ / 待 D6。

## 2. 在 Qoder 中做了什么

- 浏览器（同源 iframe 1440×900 与 375×812，真实控件操作，每步 await DOM flush）：四条 canonical 路径回放 + 6 个构造变体（V1 错排、V2/V3/V4 跳过排序与 JW 组合）、JW-01～09 逐条反馈、TC-04/06、排序门控/一次性/防重复、回看只读、重置、停表、信息流五类合并与截断、地图双态/改道/不可达/断电时刻、4 档缩放×2 时刻标记防挤、LOD、375 布局、双主题 alpha 合成对比度、徽标互斥与水印。
- 补齐编辑（仅 B _scope，未碰 A 冻结文件）：
  - [`src/views/DrillView.vue:515`](../../src/views/DrillView.vue#L515)：动作提交按钮去 `btn-sm`（26px → ≥44px）。
  - [`src/styles/console.css`](../../src/styles/console.css)：删 `.btn-sm`；`.chip-row button` 增 `min-height:44px`。
  - [`src/App.vue`](../../src/App.vue)：`.page-watermark` 24 span 页面水印（Q7 第三处）。
  - [`src/views/MapView.vue:58-69,227`](../../src/views/MapView.vue#L58)：空态提示时刻改派生 `hintTimes`（「确有标记的时刻」前 3），移除文案硬编码 `t=90 / 130 / 165`（CD-04）。`demoTimes [140,164,165]` 保留——D2 提示词 §245 明确许可且已注释来源、单独成组标「非剧本节点」。
- CLI：`check:d4` 全链 + `typecheck` + `typecheck:app` + `build` 修复后复跑（[闸门日志](d4-b-acceptance-gates.log) POST-EDIT 段）；MapView 补齐后再 build + `vite preview`（4173）生产复测。
- grep 自证（CD-04）：生产路径（DrillView/MapView/components/config/composables）零 fixture id/名称/坐标/时刻/速度/duration 硬编码；仅图标几何 `viewBox="0 0 16 16"`；DiagnosticView 的 `CONSTRUCTED_CHAIN`/`U1/U2/U3` 为诊断探针构造输入（非产品入口），同页合成 20 栋栅格自证 UI 数据驱动。
- 冻结核查：`git diff --name-only` 仅 docs×2 + `src/App.vue`、`CampusMap.vue`、`console.css`、`DrillView.vue`、`MapView.vue`；contracts/fixture-port/fixtures/schema/validate-* 零改动。dependencies 仅 `vue`。

## 3. 如何验证

环境：Chrome（Qoder Browser Connector），顶层 harness + 同源 iframe；1440×900 与 375×812；主题 ops（夜航指挥）/ daylight（教室投影）；dpr 1.5。
生产复测：`vite preview` http://127.0.0.1:4173（新构建 264.31 kB / gzip 83.39 kB）。

### 3.1 验收单 1–70 本会话实测值

| # | 实测结果（B 本会话） |
| --- | --- |
| 1 | check:d4 全链 POST-EDIT 全过：D1–D3 回归 + 26 动作重判 + D4；83/44/90；viol [14,20]/[9,14,15]/[14,21]；clock 1×=4×=45s；SC-03/03b/04/05/07/08；SC-08=46（响应 220s）；JW/排序/违规下限/单次命中/结束截断/排序一次性 |
| 2 | typecheck + typecheck:app 过（POST-EDIT）；strict/noUncheckedIndexedAccess 未放宽 |
| 3 | build POST-EDIT ✓266ms 264.01 kB/gzip 83.32 kB；MapView 补齐后 rebuild ✓266ms 264.31 kB/gzip 83.39 kB |
| 4 | git diff --name-only = docs/qoder-evidence/README.md、docs/quality-verification.md、src/App.vue、src/components/CampusMap.vue、src/styles/console.css、src/views/DrillView.vue、src/views/MapView.vue；冻结文件零改动 |
| 5 | dev 顶层+1440+375 控制台 22 条全 [debug] vite（connecting/connected/hot updated），0 error/0 warning/0 未处理 rejection；生产 preview 控制台 0 消息 |
| 6 | dependencies 仅 `vue ^3.5.45` |
| 7 | 甲 83，80/100/80/70，账本 21 行 |
| 8 | 乙 44，60/0/50/55，账本 18 行 |
| 9 | 甲+A4@150：90，80/100/100/70，命中 10/10，账本 22 行，A4 seq19 已完成@170 |
| 10 | 甲+A4@100：83，seq11 拒绝 `PRECONDITION_NOT_MET 同楼栋 A3 警戒必须先完成`，命中 8/10，账本 22 行 |
| 11 | 22 行（比甲多 1）；拒绝行 seq11 存在；后续序号平移；违规引用 [14,20]→[15,21] |
| 12 | 甲 45s·seq1；乙 250s·seq16 |
| 13 | 甲 [14,20]；乙 [9,14,15]；甲+A4@150 [14,21] |
| 14 | 甲 10/10、乙 9/10；不计入四指标（定位偏离跑总分仍 83 印证独立） |
| 15 | 结算前 #score-breakdown 不存在；点击 #finish-drill 后 wait(0) 立即渲染（生产 preview 最小流水实测） |
| 16 | 3 条对照 83/44/90 在位 + 「示例回放 · 非临场」副签；另测 V1 错排 86 |
| 17 | 诊断台三卡：getScore('run-jia-1x')=83（明确载入仅此省略第二参数）；getScore(run, snapshot.events)=83；getScore(run, events.slice(0,-1))=null→「实时评分待引擎接入」（SCORE_PENDING_TEXT，fixture-port.ts:33），不回退基线 |
| 18 | 6 卡逐字匹配 fixture：A1 上报核查 45s 无前置；A2 派队 60s；A3 警戒 30s；A4 广播疏散 20s「前置：同楼栋 A3 警戒必须先完成」；A5 封路 25s；A6 断电 35s「前置：对象楼栋必须已有灾情标注；同一楼栋不可重复断电」；nameOk/durOk/preOk 全 true |
| 19 | A5 选项 28（=campus-map.json road_segments 28，首项 R-N7E 路名）；A1–A4/A6 选项 20（=buildings 20，首项 N7）；路口 3 不入候选。注意：几何数据源是 campus-map.json，canonical-run.json 的 buildings=8 是焦点子集 |
| 20 | t=100 A2/A3 均 accepted；救援队 100→160·seq9；警戒组 100→130·seq10；其余四资源该时刻空闲（canonical 甲占用条 DOM） |
| 21 | @300 六资源全空闲（交通管制组 140→165·seq17、电工组 110→145·seq12 均释放） |
| 22 | A6→CN1 两次 rejected seq4/seq5，attempt 1/2，`TARGET_NOT_APPLICABLE 对象楼栋必须已有灾情标注` |
| 23 | 与 9/10 印证：A3 未完成 A4 拒；A3 完成后 A4 通过@170 |
| 24 | N7 已断电再提 A6 → rejected `STATUS_CONFLICT 同一楼栋不可重复断电`（甲流水 seq20，attempt2） |
| 25 | 两提交路径 catch→actionError→`role="alert"`（DrillView.vue:490/501，catch 186/210）；UI 无法触发 throw（select 仅合法 id、节点时刻提交），拒绝走 rejected 分支 alert=null；throw 路径由 CLI validate-d3.ts:84-90 覆盖（UNKNOWN_ACTION/INVALID_ACTION_TIME）。诚实注明：浏览器未实测 throw 路径 |
| 26 | 图上提交与面板提交账本行相同（seq/kind/stamp/state 一致） |
| 27 | 回看只读：6 select + 6 按钮全 disabled + 「回看只读，返回第 14 回合后可提交。」（t100 回看实测 disabled:true） |
| 28 | JW-01 U1@30 待核 → 判读正确，窗 expected 待核（[30,90)），原因原文「仅闻到烟味，尚无明火或核实结论」 |
| 29 | JW-02 U1@30 真报 → 判读有误 expected 待核 + 证据不足原因原文 |
| 30 | JW-03 U1@100 改判真报 → 正确 + 「改判 · 覆盖 seq2」（seq7 supersedes seq2） |
| 31 | JW-04 U1@100 仍待核 → 有误 expected 真报（核实事件已于 90 出现） |
| 32 | JW-05/06 U4/U5 无法定位 → 均正确；选 N7 → 「定位未命中 · 参考 萃园 7 幢（北 7）」/「定位未命中 · 参考 无法定位」，主判定分不变（甄别仍 80） |
| 33 | JW-07 U3 未判 → 「未判读」计 0（correct_judgments 9） |
| 34 | JW-08 U9 定位 N7 → 正确 |
| 35 | JW-09 定位候选 = 20 楼栋 + 「无法定位」，不含路段/路口（DOM 计数） |
| 36 | TC-06 t=100 内 3 判读 + 2 动作，5 条 t_sim 全 100 |
| 37 | 未结算 DOM 无 expected/window.reason/event_truth/priority/category；「仅闻到烟味」结算前不出现 |
| 38 | T+150 回看：#sort-entry disabled、#finish-drill 不存在 |
| 39 | T+300：10 条全可见、排序开放、参考 U2→U8→U4 |
| 40 | 他位已选选项 disabled；提交后「已提交 U2 → U8 → U4 · seq1」（生产 preview 实测） |
| 41 | 再提交返回 null，账本不新增 sort |
| 42 | 长度不足/重复/未投放 → sortReady disabled / submit null，无事件 |
| 43 | 正确→「排序正确」；错误→「排序有误」且四项总分不受影响（V1 86=90/100/80/70） |
| 44 | 跳过排序→「未提交排序」，四项照常（V2 18 / V3 15 / V4 15） |
| 45 | finishDrill 后等 ≥5 真实秒，真实用时不再增长 |
| 46 | 结算后判读/动作/排序入口全关 |
| 47 | 回看只读 HUD + 判读 select 不渲染 + 按钮 disabled；回最远节点恢复 |
| 48 | 非末回合「返回末回合查看评分」 |
| 49 | 重置：账本 0、seq 归 1、入口重新禁用、真实用时归零、对象清空、过滤回全部、回合回 1（本会话实测第 1/14 回合、账本 0） |
| 50 | TC-04 t30 A1 完成记 75；提交回合在途、≥75 已完成；submitted_at_sim 仍 30 |
| 51 | t140「积水@140/未封闭」；t220「已封闭@165·seq17」（占用条 DOM seq17） |
| 52 | 封 R-N7E → GATE3→N7 120.0px → 660.0px 经 R-N1-GATE3 |
| 53 | 封 R-N1-GATE3 → t220 N7→GATE3 unreachable「路径已计算，但当前路网无可通行路径」；R-N7E 仍积水/未封闭 |
| 54 | t130 无断电标记；t150 mark-powercut「已断电@145」+ 态势行 + 信息流 seq（本会话紧凑流水 seq9；canonical 甲 seq12） |
| 55 | mark-closed 挂路段；hazard 与 blocked 分列不合并（「积水（自然灾情）」与「已正式封闭 · seq10」两行） |
| 56 | 「携带 28 条快照路段状态（blocked / hazard 分开传递）」 |
| 57 | 0.7/1.1/2.7/5.0× × T+150/T+300：mm/ml/ll 全 0；标记恒 5/5 不丢弃 |
| 58 | LOD 4→5→21/22→22；字号屏幕恒定 |
| 59 | 五类合并 + 六 chip（全部/投放/判读/动作/排序/路况）；stamp 升序 true；t150 全部 22=投放10+判读4+动作6+路况2+排序0；t300 全部 23=10+4+6+3（生产 preview 实测） |
| 60 | 三态原文：已完成 @75/@130/@160/@145/@165；进行中「预计 @160/@130」；已拒绝「TARGET_NOT_APPLICABLE 对象楼栋必须已有灾情标注」 |
| 61 | t150/t300 信息流与路况 DOM 无 `@null`（false） |
| 62 | 回看 t60：8 行、maxStamp 60、hasLate false（全部过滤下实测） |
| 63 | 375：scrollWidth=375；6 卡均 316px 单列；maxRight 341；无横滚 |
| 64 | alpha 合成后：ops 最小 5.38（.hud-label）；daylight 最小 4.71（.badge-muted）/4.73（.action-pre）；补测 day .badge-amber 5.31 / .kv-k 5.01 / .kv-v 13.30；地图固定项两主题同：.hud-line 11.92 / .label-name 12.59 / .label-meta 5.69 / mark 文本 6.84 / zoom-level 5.51；全 ≥4.5 |
| 65 | 修复后动作提交 60×44、chip 49×44；其余控件 ≥44×44（.control/select/.btn/.seg/.layer-toggle/.road-pick/.round-tick/.sort-gate/.verdict-controls/.detail-actions） |
| 66 | 三处可见：首屏声明 + 逐条「训练模拟数据」徽标 + 页面水印 24 span（.page-watermark，opacity .06/day .08） |
| 67 | 推演：#badge-drill=「预置剧本，实时判定与评分」，无 #badge-replay；示例回放：#badge-replay=「示例回放」，无 #badge-drill；截图 drill-badge-1440 / replay-badge-1440 |
| 68 | grep：生产路径 0 fixture id/名称/坐标/时刻串/速度/duration；图标 viewBox 0 0 16 16 为图标几何；MapView demoTimes 为 D2§245 许可演示组（注释+「非剧本节点」标签）；空态提示已派生（生产实测「试试 t=90 / t=100 / t=110」）；DiagnosticView 探针常量属诊断输入 + 合成栅格自证 |
| 69 | D2/D3 回归：点选/三图层/路径三分支/1×4×/分批投放/推进回合可行动（本会话复测；1× 4.2s→1 回合、4× 4.2s→4 回合，t_sim/duration 不变） |
| 70 | TC-05 归属**待 D6**，不宣称刷新后一致 |

### 3.2 对比度表（alpha 合成后，D4 新增/复测组件）

| 组件 | ops | daylight |
| --- | --- | --- |
| .hud-label | 5.38 | 5.38（地图固定浅色板） |
| .hud-line | 11.92 | 11.92 |
| .label-name / .label-meta | 12.59 / 5.69 | 12.59 / 5.69 |
| mark 文本 / .zoom-level | 6.84 / 5.51 | 6.84 / 5.51 |
| .badge-amber | 8.42 | 5.31 |
| .badge-muted | — | 4.71 |
| .kv-k / .kv-v | 7.63 / 16.93 | 5.01 / 13.30 |
| .detail-line / .detail-name | 16.06 / 16.06 | 5.29 / 14.04 |
| .state-line.dim / .note.mono | 7.24 / 7.24 | 5.29 / 5.29 |
| .c-blue / .c-red | 8.56 / 6.18 | 6.30 / 6.52 |
| #route-unreachable span | 6.32 | 4.71 |
| .action-pre | 5.38 | 4.73 |
| .sort-form label/select/note | 7.24 / 16.06 / 7.24 | 5.29 / 14.04 / 5.29 |

### 3.3 截图清单（assets/）

- D4-2026-11-19-jia-settled-1440.png（2160×1350，甲结算 83）
- D4-2026-11-19-jia-ledger-1440.png（账本 21 行）
- D4-2026-11-19-jia-early-a4-rejected-1440.png（seq11 拒绝仍 83）
- D4-2026-11-19-yi-settled-1440.png（乙 44）
- D4-2026-11-19-jia-settled-375.png（563×1218 裁切）
- D4-2026-11-19-drill-badge-1440.png（推演徽标+声明+水印同屏，无示例回放徽标）
- D4-2026-11-19-replay-badge-1440.png（生产 preview，示例回放徽标，无推演徽标）

### 3.4 陷阱规避

- 陷阱 3（不伪造）：所有分数/拒绝原因/路径/时刻均引擎或 DOM 实测；偏离跑定位 4/10 时总分仍 83，未「修」引擎。
- 陷阱 11（偏离不回退基线）：交互路径恒带第二参数；诊断台删减末条 → null → SCORE_PENDING_TEXT。
- 陷阱 13（Vue flush）：每次 click 后 await wait(≥40ms) 再读 DOM；同步读曾得 aria-expanded 旧值。
- 陷阱 14（倍速语义）：1×/4× 只压缩真实等待（ROUND_BASE_WAIT_MS/speed），t_sim 节点与 duration_sim 不变（A1 已完成@75 两速一致）。
- 过滤态污染：chip 循环停在「路况」使截断探针无效 → 切回「全部」重测（§3.5 ⑧）。
- 数据源混淆：canonical-run.json buildings=8 ≠ port.map（campus-map.json 20/28/3）→ 期望计数改以 campus-map 为准（§3.5 ⑥）。

### 3.5 自我纠错 log

1. 定位空值 ≠「无法定位」：首跑甲定位 4/10 → 显式选择重跑 10/10；操作偏离非引擎缺陷，总分 83 不变印证独立统计。
2. window.open 致顶层 reload .destroy iframe：重建 harness + 重跑甲，值一致。
3. 375 触控缺陷（提交 26px/chip 23px）：B_scope 修复后复测 60×44/49×44。
4. 375 fullPage 最小宽=视口 928：PowerShell System.Drawing 裁切 (0,0,563,1218)。
5. 对比度探针 v1 取容器 color/半透明当不透明：v2 取叶 span + SVG fill + pill 背景合成；v3 补缺失态（day badge-amber/kv 需 t100+A2 在途+楼栋选中）。
6. fixture 比对源错误（8 vs 20/28）：核实 useFixturePort 双 imports，改以 campus-map.json 为几何期望源。
7. vite dev 模板缓存陈旧（新 script+旧 render，reload 仍旧）：以新 build + preview 生产复测为准（hint 派生值 t=90/100/110 与旧硬编码不同，证新代码生效）；**建议用户重启 npm run dev**。
8. chip 循环残留过滤态致截断测量无效：切「全部」重测 t60=8 行/maxStamp60。
9. h.txt(元素) 误用（只收选择器串）：改本地 textContent。
10. 4173 与 5173 跨域 SecurityError：顶层导航至 preview 同源重建 iframe。

### 3.6 待办与缺口

- **待 A**：五项跨轨问题（D1 起冻结待决，含预置路径缺失）；`SCORE_PENDING_TEXT` 文案仍「实时评分待引擎接入」——引擎已接入，偏离 null 的语义文案是否更新由 A 定（冻结文件 B 不擅改）。
- **待 D5+**：复盘页/公网部署/同学试用/Agent/落库/档案/导出/AI 文案（T4 的 AI 文案部分待 D7；本项已测分数即时性）。
- **待 D6**：TC-05 刷新后归属一致。
- **待补**：用户 Qoder 对话截图；dev server 重启（缓存陈旧，见 ⑦）。