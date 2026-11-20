# D5 B 轨 · 复盘深化 / 试用入口 / 公网部署 / 双人试用

- 日期：2026-11-20（采集开始 15:01，本文件随实测持续追加）
- 基线 HEAD：`9775ccc`（origin/main `ea7c9de`，A 的 D5 未推送，不等不替）
- 环境：Windows 11 26200 · Node v24.22.1 · Edge headless 157.0.4341.60（CDP 9222，临时 harness `campus-cdp.mjs` 不进仓库）· 生产预览 `npm run preview`（4173，dist 为基线构建）
- 范围：prompt/D5-B-review-deploy-trial.md 任务 0 / §1.2 token / 任务 A / B / C / D。任务 C、D 执行前须用户授权，未授权前只做本地。
- 关键文件 SHA-256（§9 收尾时实测；冻结文件 `git diff HEAD -- src/contracts.ts src/fixture-port.ts fixtures/ db/schema.sql scripts/` 为空，与基线一致）：

| 文件 | SHA-256 | 属性 |
| --- | --- | --- |
| src/contracts.ts | 479df81a4406c5c8bbe660db229ef826ccfed77d8af0f478e43239a7b5f37ec7 | A 冻结，零改动 |
| src/fixture-port.ts | 1ea0070a120181e9e0670baa3e65f74a7f7c33ecb285baa0e5fc196b9e9dac06 | A 冻结，零改动 |
| fixtures/buildings.json | 9689622dbd613396dffe7daa3a6a6718beb5faa2b646d4cdeb952279be6b9b2a | A 冻结，零改动 |
| fixtures/campus-map.json | cccf5b9ece69234095bb03d16e91f9215bc55d4c4199f8cccca8cc568d56fe82 | A 冻结，零改动 |
| fixtures/canonical-run.json | 116927275b45c3ef448addb29b81df2132c318039b0a18d62581483d8d575f08 | A 冻结，零改动（标题实证用临时副本，未触本文件） |
| db/schema.sql | ea34706c1f5044d5783b11e19559b352b00e2d55835dfeb0eb42ca476995e5d8 | A 冻结，零改动 |
| src/views/DrillView.vue | 5acc0668e14cf5ac2f64a7cb2545d0f7824f0e08a1e82a8f25387515235a7a6d | B 未提交在制品（含 D5 任务 0/A/B 改动） |
| src/styles/drill.css | 59e29fc0af07c5f9f221457affbc46988142d0dec2a39b90c8864015bbbc77b3 | B 未提交在制品（D4+ 新建，D5 token/场景卡/徽标避让改动；哈希为任务 C 收尾时重测） |
| src/styles/console.css | 9fdf374cebb1cef9a0237d3b4d8779492785a5e19385931b9ea43aecc7b56e35 | B 未提交在制品（含 D5 token 单一源改动） |
| src/config/rounds.ts | 10c7fcdd6b58269982277731affbd718d319cb6ab124f3c6f721d26de3389050 | B 未提交在制品（D5 场景卡常量） |
| src/config/review-summary.ts | 5b622088ff92281327106ce3f4f74fdb6b84f0cc34656e9d55a7a7e3d5a09003 | B D5 新增（预置摘要，未提交） |
| src/App.vue | 986094ca99863845d9e0bbe784f9a18c1af4dafcdc43e85bcd7f9e92063f9abb | B 未提交在制品（水印为 D4 补齐，D5 复验） |
| index.html | 95e8d15c7269c0d680067d82fcbf7fe40e43d5ae4df2a6493f38f2e2b9a8dd11 | B 任务 C 收尾修正（标题去「接口诊断台」、color-scheme light dark、底色 #eef2ee 防暗闪；哈希为修后实测） |

## 0. 基线闸门（15:01:35 实测）

完整输出见 [d5-baseline-gates.log](d5-baseline-gates.log)。

| 闸门 | 结果 |
| --- | --- |
| npm ci | EXIT=0（55 packages；首次 EPERM 因 D4 残留 dev 进程占用 rolldown binding，结束 PID 30776 后重跑通过） |
| npm run check:d4 | EXIT=0（83/44/90、SC-08=46、时钟 1×=4×=45s、RE-06 660.04px 绕行、JW/Sort/Scoring 全过） |
| npm run typecheck:app | EXIT=0 |
| npm run build | EXIT=0（53 modules；index-CAyVRN4O.css 81.87 kB / gzip 16.41；index-BlRZTf-g.js 280.49 kB / gzip 90.27；306ms） |

## 1. 任务 0 修前证据（15:05–15:26 实测，生产预览基线构建）

### 0-1 回放 HUD 与缩放控件重叠

示例回放页 `.map-zoom`（左上，3×44px 按钮 + 倍速读数）与 `.hud-tl`（模拟时钟牌）矩形相交：

| 视口 / 主题 | .map-zoom (x,y,w,h) | .hud-tl (x,y,w,h) | 相交 |
| --- | --- | --- | --- |
| 1440×900 daylight | 25, 178.6, 184.8×44 | 35, 186.6, 150.9×94.4 | **true** |
| 1440×900 ops | 25, 178.6, 184.8×44 | 35, 186.6, 150.9×94.4 | **true** |
| 375×812 daylight | 21, 260.9, 184.8×44 | 31, 268.9, 104.2×61 | **true** |
| 375×812 ops | 21, 260.9, 184.8×44 | 31, 268.9, 104.2×61 | **true** |

375 下 `.hud-tr`/`.hud-br` display:none（console ≤640 规则）。HUD 字体违反 drill 字阶：

- ops `.hud-clock`：38px · Bahnschrift/DIN · color rgb(255,178,36)（amber）· text-shadow 有。
- daylight `.hud-clock`：38px · Bahnschrift/DIN · color rgb(51,48,42)（硬编码 #33302a）· letter-spacing 1.14px。
- `.hud-label`：10px · letter-spacing 1.6px（eyebrow 式排布）。
- HUD 牌底 daylight 实测 rgb(251,252,248)/边 rgb(203,216,206)（已等于 --map-hud-plate/edge，牌底无需改；时钟与标签需改）。
- `.hud-tl` 文本含 `T+300s` 与 `分支 甲 · run-jia-1x`（并入 0-3）。

截图：assets/d5-0-1-before-hud-zoom-{day,ops}-{1440,375}.png（4 张，fullPage，dpr 1.5/2）。

### 0-2 分区名被路网与建筑覆盖

SVG 直接子层顺序（实测）：`layer-base → layer-landscape → district-labels → layer-road-bed → layer-roads → layer-shadows → layer-glow → layer-scene → layer-marks → layer-labels`。district-labels 索引 2，在 roads(4)/scene(7) **之前**绘制，被覆盖。4 个分区标签：萃园(64.5,8.1)、润园(1148.25,46.6)、至行苑(978,454.7)、学海苑(435.75,277.6)；样式 fill rgb(75,98,87)、stroke none、paintOrder normal、18px（无描边晕）。

截图：assets/d5-0-2-before-district-day-1440.png、d5-0-2-before-district-{day,ops}-zoom13.png（缩放步实测为 1.3×，非 1.45×，文件名按实测）。

### 0-3 学员面前暴露开发口径

回放页逐 rail tab（时间轴/道路/路径/图例/评分）+ 展开 details 扫描 `.mapwrap` innerText，正则 `ready|px|reason:|run-|seq`：105 命中，去重 15 行：

- 封闭·seq17（地图路障标记，CampusMap.vue:1361）
- 分支 甲 · run-jia-1x（HUD）
- 北 7 东侧至 3 号门 · 已封闭 @165 · seq17（道路表）
- 甲 · run-jia-1x / 乙 · run-yi-1x / 甲补做A4 · run-jia-plus-a4（流水选择器）
- 30→75 · seq1 / 100→160 · seq9 / 100→130 · seq10 / 140→165 · seq17 / 110→145 · seq12（资源占用条）
- 积水 @140 已封闭 @165 · seq17（道路表）
- 正式封闭：A5 封路成功后红色路障，标注封闭时刻与动作 seq。两者可同时存在。（图例）
- 疏散路径：亮色虚线 + 暗色包边，长度为图上 px（非实际距离或耗时）；引擎接入前显示待接入空态。（图例）
- 首报 U1 · 有效响应 45 秒 · seq1（ScorePanel）

路径查询（N7→LIB @300，ready 态）实测文本：`ready @300` / `5 段 · 路网计算长度 1267.6 px` / 段表裸 ID `R-N7-N1` 等 / `query 携带 28 条快照路段状态（blocked / hazard 分开传递）`。

不可达态（推演内构造：T+140 对 R-N1-GATE3 提交 A5，完成于 T+165；R-N7E 自 T+140 积水阻断；N7→GATE3 查询）：`路径已计算，但当前路网无可通行路径` + `reason: 当前路网无可通行路径`。此构造同时复验 D3「备用路封闭后不可达」语义。截图 assets/d5-0-3-before-routepanel-1440.png、d5-0-3-before-reason-unreachable-1440.png。

推演页（T+30 提交 A1(N7) 后）实测：

- 信息流/账本：`00:30 · 动作 A1 上报核查 → 萃园 7 幢（北 7） · 第1次 · 进行中 · 预计 @75`（内部枚举 A1、裸 @75）。
- 资源占用：`30→75 · seq1`。
- 结算后复盘：`首报 U1 · 有效响应 45 秒 · seq1`、`重复违规 0 次 · 事件序号 []`、遗漏项 `封路 · R-N7E`（fixture label 原样含路 ID）。
- 情状：`北 7 三层确认为真实火情 @90`、`积水 @140`。
- 动作反馈块已用 `T+01:15`（D4 已修，保持）。

完整扫描输出留存于采集会话（$TEMP/d5-0-3-before-replay.json，105 条）；上表为去重全文。

### 0-4 结算后仍显示「待判读」

推演 A1 单动作流程结算后实测：上报 chip 仍 `10 条待判读`；已收到列表 10 条全部 `待判读`；当前上报块 `未判读`（不揭示当时应判）。截图 assets/d5-0-4-before-settled-chip-1440.png。该流水总分 39（甄别 0/响应 100/命中 10/合规 100，A1 完成 @75 → 首报响应 45s）。

纯零操作结算（重置后直接推进至 T+300 结束）：**15/100**（甄别 0/响应 0/命中 0/合规 100），`本轮无已完成的首报响应`，遗漏 6 项，`未做排序`，参考排序 U2→U8→U4。实际用时 3.3s。截图 assets/d5-0-4-before-zero-op-15-1440.png。任务 B 以 15 为诚实基线。

### 0-5 首屏无时长/免登录说明，右栏无玩法引导

intro 实测文本：`今晚，你来值班 / 上报会陆续送到。读完消息，到地图上找楼栋或道路，再决定怎么处置。发现新线索时，可以改判。/ 开始推演 →`。无时长、免登录、训练模拟说明。右栏 !started 空态仅 `开始推演后，在地图点选楼栋或道路，即可对该对象下达指令。`，无三步玩法。按钮文案 `开始推演 →`（任务 A 改「开始一次推演」）。

截图：assets/d5-0-5-before-intro-day-{1440,375}.png。

## 2. §1.2 token 整改前计算值快照（15:24 实测）

getComputedStyle(document.documentElement)，两主题。整改后必须逐项不变（观感不变项）：

| token | ops | daylight |
| --- | --- | --- |
| --map-void | #263a30 | #e1e6de |
| --map-ground | #263a30 | #ece8d8 |
| --map-facade-west | #40564a | #928777 |
| --map-roof-top | #a2b2a6 | #f5f0e3 |
| --muted | #b4c5bb | #4e635a |
| --map-road-center | #9bb2a5 | #f6f3ec |
| --map-band-dark | #0a1017 | #8d979e |
| --map-band-lit | #ffc46b | #8d979e |
| --map-band-cool | #9fd8ff | #8d979e |
| --map-tree-trunk | #241d16 | #9c8668 |
| --map-crossing | #1a2430 | #d8d2c6 |
| --map-crossing-dot | #3d4f63 | #a89f8d |
| --map-hud-plate | #1c2b24 | #fbfcf8 |
| --map-hud-edge | #4a6558 | #cbd8ce |
| --map-hud-ink | #f1f5ef | #253c31 |
| --map-hud-dim | #c0d1c8 | #4e655b |
| --map-label-plate | #1c2b24 | #fbfcf8 |
| --map-label-ink | #f1f5ef | #21372e |
| --map-label-dim | #c0d1c8 | #4b6257 |
| --work-bg | #15201c | #eef2ee |
| --paper | #eff6ef | #1d3029 |
| --blue | #41b9ff | #0959a8 |
| --amber | #ffb224 | #7a5400 |
| --green | #37d67a | #126338 |
| --red | #ff5c5c | #a92019 |

（--accent 在 :root 无定义，drill 用别名，整改时核实。）

## 3. 任务 0 修后实测（本节测量完成于 16:10 前，生产预览 4173 新构建）

修后构建：`npm run build` EXIT=0（vue-tsc 模板检查 + vite；54 modules；index-DjImbHNK.css 74.54 kB / gzip 14.77；index-BMi8CxjF.js 282.73 kB / gzip 91.05）。预览已确认伺服新 bundle（curl index.html 哈希一致）。

**自纠 1（构建闸门）**：RoutePanel.vue 学员侧不可达分支首版直接写 `route.status === 'unreachable' && technical` 复合条件，`npm run typecheck`（纯 tsc，不查 .vue 模板）通过但 `npm run build`（vue-tsc）报 6 错（TS18047 possibly null ×4、TS2339 reason 不在 ready 变体 ×2）。修法：仿照既有 `ready` computed 增加 `unreachable = computed(() => props.route?.status === 'unreachable' ? props.route : null)`，96–97 行改用该窄化引用；v-if/v-else-if 主链保持原条件以保留 ready 分支窄化。修后 build EXIT=0。教训：.vue 模板改动必须以 build（vue-tsc）为准，不能只跑 typecheck。

**自纠 2（更严口径复扫）**：修后扫描把正则从 `ready|px|reason:|run-|seq` 加严为 `ready|px|reason:|run-|seq|@\d|\bA[1-6]\b`，发现 3 处残留（各在 5 个 rail tab 重复出现）：图例「来自 A3 警戒动作」「来自 A2 救援动作」（config/layers.ts desc）、灾情图例「来自剧本 disaster_confirm 事件」、流水选择器分支名「甲补做A4」（fixture 原文含动作编号）。修法：layers.ts 三处 desc 改为学员语言（警戒处置 / 救援队派遣 / 剧本确认的灾情）；MapView 增 `branchLabel()`，用 `fixture.action_catalog` 把分支名中的动作编号替换为动作名（甲补做A4 → 甲补做广播疏散），HUD / 流水选择器 / 评分轨头三处消费；DiagnosticView 不受影响（仍显 run_id · branch 原文）。修后复扫 0 命中。

### 3.1（0-1）HUD 与缩放控件重叠 → 已分离

`.hud-tl/.hud-tr` 自 top:10 改为 top:64px（让出 CampusMap 自有 `.map-zoom`/`.map-orient`），HUD 牌底/字阶重写（drill 字阶）。五元素两两相交全测（10 对）：

| 视口 / 主题 | .map-zoom | .hud-tl | .hud-tr | .map-orient | 相交对 |
| --- | --- | --- | --- | --- | --- |
| 1440×900 daylight | 25, 178.6, 184.8×44 | 25, 232.6, 121.3×85.2 | 896.8, 232.6, 154.2×78 | 906.8, 182.6, 144.3×43.6 | **0 / 10** |
| 1440×900 ops | 同上 | 同上 | 同上 | 同上 | **0 / 10** |
| 375×812 daylight | 25, 262.9, 184.8×44 | 25, 316.9, 121.3×63 | display:none | 332.8, 266.9, 15.2×20.8 | **0 / 10** |
| 375×812 ops | 同上 | 同上 | display:none | 同上 | **0 / 10** |

zoom 底边 222.6 与 hud-tl 顶边 232.6 留 10px；orient 底边 226.2 与 hud-tr 顶边 232.6 留 6.4px。375 下 `.map-minilegend` 25, 448.6, 269.1×49 亦不相交。

HUD 字阶修后（两主题一致，仅颜色随主题）：`.hud-clock` 24px · weight 750 · sans（PingFang SC/Microsoft YaHei…）· tabular-nums · text-shadow none · letter-spacing normal；daylight color rgb(37,60,49)=--map-hud-ink，ops rgb(241,245,239)。`.hud-label` 11px · letter-spacing normal · color=--map-hud-dim（day rgb(78,101,91) / ops rgb(192,209,200)）。修前 38px Bahnschrift/DIN + amber + shadow + 1.14px 字距全部消除。HUD 文本：`模拟时钟 | T+05:00 | 分支 甲`（run id 已移除）。

截图：assets/d5-0-1-after-hud-zoom-{day,ops}-{1440,375}.png（4 张 fullPage）。

### 3.2（0-2）分区名覆盖 → 图层后移 + 描边晕

SVG 直接子层修后顺序（class 实测）：`defs → layer-base → layer-landscape → layer-road-bed → layer-roads → layer-shadows → layer-glow → layer-scene → district-labels(索引 8) → layer-marks → layer-labels`。district-labels 在 scene 之后、marks 之前（修前索引 2 在 roads 之前）。

4 标签（萃园/润园/至行苑/学海苑，坐标不变）修后样式：paint-order **stroke** · stroke-width **4px** · stroke-linejoin round · font 18px/650 · letter-spacing 2.34px；fill=--map-label-dim（day rgb(75,98,87) / ops rgb(192,209,200)），stroke=--map-label-plate（day rgb(251,252,248) / ops rgb(28,43,36)）——纸色描边晕，两主题实测。

截图：assets/d5-0-2-after-district-day-1440.png、d5-0-2-after-district-{day,ops}-zoom13.png（缩放步实测 1.0×→1.3×，与修前一致）。

### 3.3（0-3）开发口径暴露 → 学员侧 0 命中

加严正则 `ready|px|reason:|run-|seq|@\d|\bA[1-6]\b`：

- 回放页：t=300，逐 rail tab（时间轴/道路/路径/图例/评分）+ 全 details 展开 + 路径 ready 态 + 路段详情 + 楼栋详情，**.mapwrap innerText 0 命中**（修前 105 命中 / 15 行）。完整输出 $TEMP/d5-post-03-replay.json。
- 推演页：A1 单动作流水结算后，逐 dock 面板切换 + 全 details 展开扫 `.drill-workspace` innerText，**0 命中**（含信息流/账本/占用/情状/复盘）。输出 $TEMP/d5-post-04-drill.json、d5-post-04b-drill.json。

关键文本修后实测：

| 位置 | 修前 | 修后 |
| --- | --- | --- |
| 路径 ready 徽标 | ready @300 | 已算出可通行路线 |
| 路径长度 | 5 段 · 路网计算长度 1267.6 px | 共 5 段路（图上示意 · 非实际距离） |
| 段表 | 裸 ID R-N7-N1 | 萃园 7 幢至 1 幢（道路名） |
| 不可达（推演内构造） | reason: 当前路网无可通行路径 | 不可达原因：当前路网无可通行路径 |
| 道路封闭 | 已封闭 @165 · seq17 | 已封闭 T+02:45 · 第 17 条操作 |
| 动作反馈 | A1 … 预计 @75 | 上报核查 · 执行中 / 预计完成于 T+01:15 |
| 账本 | 动作 A1 … 预计 @75 | 上报核查 → 萃园 7 幢（北 7） · 第1次 · 已完成 T+01:15 |
| 占用条 | 30→75 · seq1 | 00:30→01:15 · 第 1 条操作 |
| 复盘首报 | 首报 U1 · 有效响应 45 秒 · seq1 | 首报 U1 · 有效响应 45 秒 · 第 1 条操作 |
| 遗漏项 | 封路 · R-N7E | 封路 · 北 7 东侧至 3 号门（endpointName 补道路查找） |
| 情状 | 真实火情 @90 / 积水 @140 | 真实火情 T+01:30 / 积水 T+02:20（未封闭） |
| 流水选择器 | 甲补做A4 · run-jia-plus-a4 | 甲补做广播疏散（branchLabel，仅分支名） |
| 图例 | 来自 A3 警戒动作 / A2 救援动作 / disaster_confirm | 来自警戒处置 / 救援队派遣 / 剧本确认的灾情 |

静态封闭诚实性：closedStamp(atSim, bySeq) 在 bySeq=null（静态封闭 closedAt=0）时只给时刻，不编造操作引用。

不可达构造复验（与修前同构造）：重置后推进至 T+02:20(140)，对 R-N1-GATE3 提交 A5（预计完成 T+02:45=165），再推进至 T+03:40(220)，N7→GATE3 查询 → `路径已计算，但当前路网无可通行路径` + `不可达原因：当前路网无可通行路径`；情状同步显示 `北 1 至 3 号门（训练备用道路） · 已封闭 T+02:45 · 第 1 条操作`。备用路封闭后不可达语义（D3）复验通过。

DiagnosticView 技术口径保留（豁免页）：diag innerText 仍含 run-jia-1x · 甲 · 1×、seq、length_px 等 27 行技术文本；RoutePanel technical 分支代码未改（`ready @` / `reason:` / px 原样），诊断页路径查询的 technical 渲染留待 §回归（任务 #40）实测。

截图：assets/d5-0-3-after-routepanel-1440.png、d5-0-3-after-legend-1440.png、d5-0-3-after-reason-unreachable-1440.png。

### 3.4（0-4）结算后「待判读」→ 已结算 + 逐条揭示

A1 单动作流水（T+30 提交 A1(N7)，推进至 T+300 结束）修后实测：

- chip：**已结算**（修前「10 条待判读」）。
- 已收到列表 10 条 small 全部 **未判读**（修前「待判读」）。
- 复盘总分 **39 / 100**（甄别 0 / 响应 100 / 命中 10 / 合规 100），首报 U1 · 有效响应 45 秒 · 第 1 条操作，遗漏 5 项全用动作名 + 对象名。与修前基线一致。
- 逐条揭示（U1，未判读）：`本轮未判读 / 收到时（T+00:30）可判为「待核」。仅闻到烟味，尚无明火或核实结论 / 自 T+01:30 起可判为「真报」。导调已核实北 7 三层真实火情 / 参考位置 萃园 7 幢（北 7）`。
- 逐条揭示（U10，单判断窗）：`本轮未判读 / 收到时（T+02:30）可判为「误报」。仅传闻且明显夸大 / 参考位置 无法定位`。

纯零操作结算（重置后直接推进至 T+300 结束）：**15 / 100**（甄别 0 / 响应 0 / 命中 0 / 合规 100），`本轮无已完成的首报响应`，遗漏 6 项（上报核查/派队/警戒/广播疏散/封路/断电，对象均为可读名），`未做排序`，参考排序 U2→U8→U4，实际用时 3.3s。与修前诚实基线一致。

**接口缺口（向 A 提问，见 §问题清单）**：score-engine.ts:31 `assessReport` 仅在 `attempt` 存在时给 `window`（`window = attempt ? windowAt(...) : null`），故 judgments 对未判读上报 window=null，无法直接满足 prompt 0-4「未判读上报结算后直接揭示当时可判 + 理由」。B 侧修法：仅展示层用 A 已导出的只读 `windowAt(fixture, reportId, t)` 读 fixture 判断窗，取「收到时 appears_at_sim」与「回合末 tEnd」两个明确标注的时刻（两窗不同则都给），不参与评分、不改引擎语义；有判读动作的上报仍严格用 judgments[].window。建议 A 在 D6/D7 复盘契约里让 judgments 对未判读上报也携带判断窗（或约定揭示时刻口径）。

截图：assets/d5-0-4-after-settled-review-39-1440.png、d5-0-4-after-settled-reveal-u1-1440.png、d5-0-4-after-zero-op-15-1440.png。

### 3.5（0-5）首屏半成品 → 时长说明 + 三步玩法

intro 修后实测全文：`今晚，你来值班 / 上报会陆续送到。读完消息，到地图上找楼栋或道路，再决定怎么处置。发现新线索时，可以改判。/ 全程约 5 分钟 · 免登录 · 训练模拟 / 开始一次推演`。新增 `.intro-meta`（--work-accent 12px/700）；按钮文案「开始一次推演」（去箭头，#start-drill 保留）。

右栏 !started 空态修后：`三步玩法：① 读上报并判读：真报 / 误报 / 待核 ② 在地图点选楼栋或道路，下达处置指令 ③ 末回合排出最紧急的上报，结束并查看评分`（`.order-empty` + `.order-steps` 有序列表，沿用既有空态语言，无新卡片风格）。

截图：assets/d5-0-5-after-intro-{day,ops}-1440.png、d5-0-5-after-intro-day-375.png（375 不溢出，fullPage）。

## 4. §1.2 token 单一源整改 · 修后计算值对照（16:09 实测）

整改：main.ts 导入序 console.css → drill.css（drill 同特异性后胜出）；两主题 `html[data-theme]` 的 ink/line/paper/muted 与大部分 map-* token 单一源在 drill.css；console.css 删除重复定义与死 chrome（topbar/brand/ribbon/statusbar/page-foot/night 覆盖等），仅保留 drill 未定义的语义色、派生 token、字体、圆角及 --map-road-center/band-*/tree-trunk/crossing* ；断点 max-900→920、min-901→921、max-400→390 与 drill 统一。

getComputedStyle(document.documentElement) 修后 vs §2 修前快照（$TEMP/d5-token-before-{ops,day}.json vs d5-token-after.json）：**25 个观感不变 token × 2 主题逐项相等，0 差异**。--accent 修前修后均在 :root 无定义（""），drill 消费 --work-accent（daylight 实测 #205947）。CSS 体积 81.87 kB → 74.54 kB（gzip 16.41 → 14.77），减少来自死 chrome 删除，非观感 token 变化。

## 5. 修后闸门（16:09–16:10 实测）

完整输出见 [d5-post-fix-gates.log](d5-post-fix-gates.log)。

| 闸门 | 结果 |
| --- | --- |
| npm run check:d4 | EXIT=0（83/44/90、SC-08=46、时钟 1×=4×=45s、violations 甲[14,20] 乙[9,14,15] 甲补做[14,21]、JW/Sort/Scoring 全过） |
| npm run typecheck:app（vue-tsc） | EXIT=0 |
| npm run build | EXIT=0（54 modules；index-DjImbHNK.css 74.54 kB / index-BMi8CxjF.js 282.73 kB） |
## 6. 任务 B 修后实测（复盘三块，16:40–17:20，生产预览 4173）

实现（不改引擎/契约/fixture）：
- 新文件 `src/config/review-summary.ts`：确定性模板 `buildReviewSummary(RoundScore, names)` + 常量 `REVIEW_SUMMARY_BADGE = '预置摘要 · AI 点评待接入'`。
- `DrillView.vue`：`timelineRows`（与 ledgerRows 同源，类型细化 判读/改判/动作/拒绝/排序）、`missRows`（仅评分器输出）、`jumpToMiss`、`backToTimeline`（账本→时间线互跳）、`summaryLines`、`learnerReason`（拒绝原因编号→动作名，见自纠 3）。
- `drill.css`：`.review-timeline/.miss-list/.miss-row/.summary-list` 等，沿用 ledger 列表语言与既有 token，无新卡片体系。
- 修后构建：55 modules；index-BhnNOi28.css 75.49 kB / gzip 14.92；index-DX9nzRPC.js 289.30 kB / gzip 93.10。

### 6.1 构造流水（覆盖拒绝/改判/进行中/违规/排序失误）

T30 判 U1 误报（未定位）→ A1(N7)；T90 改判 U1 真报+N7、判 U2 误报（未定位）；T100 A4(N7) 被拒 ×2（同楼栋警戒必须先完成）→ A3(N7)；T150 A4(N7) 通过；T250 A2(N7)（完成于 T+05:10 > 300）；T300 排序 U1→U2→U3（参考 U2→U8→U4）→ 结束。

实测总分 **53 / 100**（甄别 10 / 响应 100 / 命中 50 / 合规 85），与按引擎规则独立推算一致：round(10×.3 + 100×.2 + 50×.35 + 85×.15) = round(53.25) = 53。首报 U1 响应 45s（A1 完成 @75）。

### 6.2（#19/#20）时间线 = 账本，真实用时冻结

`#review-timeline` 10 条 = `#ledger-table` 10 条（本轮已确认流水数）。逐条对照（时刻/对象/结果一致；时间线类型细化、账本保留原类型）：

| # | 时间线 | 账本 state |
| --- | --- | --- |
| 1 | 00:30 · 判读 · 第 1 条操作 · U1 → 误报 · 未定位 | 已记录 |
| 2 | 00:30 · 动作 · 第 2 条操作 · 上报核查 → 萃园 7 幢（北 7） · 第1次 | 已完成 T+01:15 |
| 3 | 01:30 · **改判** · 第 3 条操作 · U1 → 真报 · 萃园 7 幢（北 7） | 改判 · 覆盖第 1 条操作 |
| 4 | 01:30 · 判读 · 第 4 条操作 · U2 → 误报 · 未定位 | 已记录 |
| 5 | 01:40 · **拒绝** · 第 5 条操作 · 广播疏散 → 北 7 · 第1次 | 已拒绝 · 同楼栋警戒必须先完成 |
| 6 | 01:40 · **拒绝** · 第 6 条操作 · 广播疏散 → 北 7 · 第2次 | 已拒绝 · 同楼栋警戒必须先完成 |
| 7 | 01:40 · 动作 · 第 7 条操作 · 警戒 → 北 7 · 第1次 | 已完成 T+02:10 |
| 8 | 02:30 · 动作 · 第 8 条操作 · 广播疏散 → 北 7 · 第3次 | 已完成 T+02:50 |
| 9 | 04:10 · 动作 · 第 9 条操作 · 派队 → 北 7 · 第1次 | **已通过 · 进行中 · 预计 T+05:10** |
| 10 | 05:00 · 排序 · 第 10 条操作 · U1 → U2 → U3 | 已记录 |

拒绝原因原文语义保留（编号渲染为动作名，见自纠 3）。互跳实测：时间线「在操作记录中核对」→ tools 账本；账本「回到复盘时间线」→ data-side=review。真实用时 **13.4 秒 → 13.4 秒**（间隔 1.6s 两次读取相等，冻结）；与模拟时长 T+05:00 分开呈现。零操作时间线 0 条 + 空态「本轮没有已确认的操作。」。

### 6.3（#21）失误定位：15 行全来自评分器，跳转逐项实测

构造流水失误行 15 条（漏做 3：派队/封路/断电；判读 1：U2 误报；定位 1：U2 未填写；未判读 8：U3–U10；排序 1；违规 1），行高 62/80/99px 均 ≥44。依据逐字取评分器输出：U2 判读依据 = window.reason 原文「明火与浓烟同时被目击，证据充分」；漏做依据 =「应于回合结束（T+05:00）前完成」（t_end 完成截止口径，missed_items 无时刻字段，见 §7 问题 2）；违规依据 = 第 6 条操作重复被拒 + 原因原文。

跳转实测（桌面 1440）：

| 行 | 跳后时钟 | 面板 | 定位/选中 | 只读 | 复盘可见 |
| --- | --- | --- | --- | --- | --- |
| 判读 U2 | T+01:30 | reports | U2 卡片 · 判断有误 + 当时可判「真报」+ 原因原文 | 指令栏「只读」chip | 否（仅末回合） |
| 漏做 派队 | T+05:00 | orders | 地图已选中 萃园 7 幢（北 7） | 「只读」chip | 是 |
| 违规 | T+01:40 | orders | 北 7 选中（指令栏显示该对象最新动作） | 「只读」chip | 否 |
| 排序 | T+05:00 | review | #drill-sort-result 排序有误 + 参考 | — | 是 |
| 定位 U2 | T+01:30 | reports | U2 卡片 · 参考位置 北 7 | 「只读」chip | 否 |

375 同测：U1 未判读行 → T+00:30 reports U1（收到时待核 + 自 T+01:30 真报双窗揭示）；漏做上报核查行 → T+05:00 orders 北 7 选中 +「只读」+「本轮已结算。可查看当时的指令状态。」。回看态 header 出现「返回复盘」，点击回末回合恢复完整复盘（#24）。

### 6.4（#22）预置摘要

徽标实测 **「预置摘要 · AI 点评待接入」**。构造流水 17 行、零操作 17 行，逐条引用 seq（第 N 条操作）/ 上报 id / 动作名 + 对象名（动作 id 经目录名可追溯，学员侧不露内部枚举，与 0-3 口径一致；见 §7 问题 5）。无真实事件指挥建议（FR-6.4），无 AI 声称、无加载态。离线证据：`performance.getEntriesByType('resource')` 源仅 `http://localhost:4173`，外部请求 0；摘要为本地纯函数，断网不影响渲染。

### 6.5（#16/#17/#18/#23）诚实性回归

| 例 | 分项（甄别/响应/命中/合规） | 总分 | 来源 |
| --- | --- | --- | --- |
| 甲 | 80/100/80/70 | **83** | 回放评分轨，1440 + 375 实测 |
| 乙 | 60/0/50/55 | **44** | 同上 |
| 甲补做广播疏散（T150 A4） | 80/100/100/70 | **90** | 同上 |
| 甲+T100 A4 被拒 | — | **83** | check:d4 CLI（too early → 83 / on time → 90）；拒绝原因可见性在构造流水浏览器实测 |
| 构造流水（6.1） | 10/100/50/85 | **53** | 推演页浏览器实测 |
| 零操作 | 0/0/0/100 | **15** | 推演页，daylight 1440 / ops 1440 / 375 三态实测 |

权重核算（30/20/35/15）：83=round(82.5)、44=round(43.75)、90=round(89.5)、53=round(53.25)、15=round(15)，逐项可核。定位（#drill-location-score）与排序（#drill-sort-result）独立于总分展示；零操作「未做排序」+ 参考 U2→U8→U4、定位 0/10。wait(0) 断言：点「结束推演并查看评分」后 setTimeout(0) 即有 `#score-breakdown`（375 实测 7ms / 1440 实测 10ms），无 `#score-pending`，外部请求 0（T4）。回放交互路径 `port.getScore(runId, snapshot.events)` 第二参数在（MapView.vue:79），未回退基线分。

### 6.6（#26 部分）375 与两主题

375：失误行 62×319px（17 行全 ≥44）、时间线 summary 46px、无横向溢出、dock 可见、复盘面板内滚（client 449 / scroll 2513，页面不滚）。ops 主题零操作复盘 15/100 同布局。触控/键盘完整走查与对比度归任务 #40。

截图（assets/）：d5-b-review-top-day-1440.png、d5-b-review-full-day-1440.png（1440×2400 全高）、d5-b-misslist-day-1440.png、d5-b-jump-u2-after-day-1440.png、d5-b-zero-op-15-day-1440.png、d5-b-replay-jia-83-1440.png、d5-b-replay-yi-44-1440.png、d5-b-replay-jia-plus-90-1440.png、d5-b-review-375-day.png、d5-b-misslist-375-day.png、d5-b-jump-u1-375-day.png、d5-b-review-ops-1440.png（12 张）。

闸门：[d5-b-gates.log](d5-b-gates.log) — check:d4 EXIT=0（83/44/90、SC-08=46、JW/Sort/Scoring 全过）、typecheck:app EXIT=0、build EXIT=0。

### 自纠 3（拒绝原因暴露内部编号）

构造流水首次实测发现拒绝原因原文「同楼栋 **A3** 警戒必须先完成」含内部动作编号（fixture precondition description 原文），违反 0-3 学员侧口径；此前 0-3 扫描用的 A1 单动作流水无拒绝，未覆盖此面。修法：`learnerReason()` 先把「编号+动作名」渲染为动作名（含前导空格清理），剩余裸编号按目录替换；应用于信息流/账本/失误依据/指令反馈 4 处。修后「同楼栋警戒必须先完成」，加严正则复扫（含拒绝态、全 dock 面板 + details）**0 命中**。语义与 reject_reason_code 不改，仅展示层编号→名。已列入 §7 问题 4 请 A 定夺描述文案归属。

### 自纠 4（失误跳转落错上报）

首版 `jumpToMiss` 先 `goToTime` 再 `selectReport`，被 `watch(currentT)` 的 reportChoice 清空 watcher 在 flush 时覆盖，判读 U2 行实际落到 U5（修前实测 reportRef=U5）。修法：goToTime 后 `await nextTick()` 等 watcher flush 再定位。修后 U2 行 reportRef=U2、assessment=判断有误+真报窗（实测）。

### 自纠 5（截图误标）

回放乙截图链路中一条 eval 因 harness 全局作用域 `const s` 重复声明静默失败，截到的仍是甲 83。核实实际 run-select 值后以 IIFE 重设乙、确认 44/100 再重拍 d5-b-replay-yi-44-1440.png。教训：链式 eval 必须逐条核对返回，截图前核实页面实际状态。

## 7. 问题清单（向 A，D5 期间累积）

1. **judgments 未判读上报 window=null**（score-engine.ts:31）：B 展示层用只读 `windowAt` 在「收到时 + 回合末」两时刻揭示（0-4/6.3），不参与评分。建议 D6/D7 复盘契约让 judgments 对未判读上报也携带判断窗，或约定揭示时刻口径。
2. **missed_items 无应完成时刻字段**：B 用 t_end 完成截止口径表述「应于回合结束（T+05:00）前完成」。建议契约补 explicit expected-by（或确认 t_end 口径冻结）。
3. **prompt §7.2「理由取 event_truth.reason」与契约不符**：contracts.ts EventTruth 无 reason 字段（is_real/locatable/building_id），理由实际在 JudgmentWindow.reason。B 按 window.reason 原文展示。请修订 prompt/文档口径。
4. **拒绝原因原文含动作编号**（A4 precondition description「同楼栋 A3 警戒必须先完成」）：与学员侧不露内部枚举冲突。B 暂以 learnerReason 展示层编号→名（自纠 3）。请 A 定夺：fixture 描述改学员语言，或共享一个 normalize 函数（D7 摘要也会消费拒绝原因）。
5. **预置摘要常量归属**（prompt §15.1 同问）：D5 模板在 B 的 `src/config/review-summary.ts`；FR-6.3「引用动作 id」B 按「目录名可追溯 + 不露枚举」执行。D7 的 8 秒兜底摘要常量谁提供、放哪个共享模块？请确认引用口径（名 vs id）。
6. **D6 保存/恢复接口形状**：run_events 落库时机与读回重算接口；D5 时间线/失误行均为 snapshot.events + RoundScore 派生，无落库，与 D6 读回兼容。
7. **D7 复盘输入契约 / 第二案例 fixture 时机**：待 A 排期。
8. **站点归属与公开策略**（任务 C 前置）：复用 D2 站 `01a1e975-…`？是否公开？须用户授权后执行。
9. **分区注记图层后移**（0-2）：仅绘制顺序变化，坐标/文案未动；请 A 知悉地图校验口径不受影响。

## 8. 任务 A 实测（五步试用入口 + 场景卡，2026-11-20 17:00 前后）

环境：`vite preview` 4173 服务本地构建；CDP 实测 1440×900@dpr1.5 与 375×812@dpr2；默认 daylight。原始输出：`$TEMP/d5-a-01.json`（1440 起始）、`$TEMP/d5-a-02.json`（五步走查）、`$TEMP/d5-a-03.json`（375 起始）。

### 8.1 实现改动（3 文件）

- `src/config/rounds.ts`：新增 `SCENARIO_MODIFIER_LABELS`（night 夜间 / heavy_rain 暴雨 / comms_outage 通信中断 / crowd_peak 人流高峰）与 `SCENARIO_CARD_NOTE = '本期 1 个预置剧本；AI 随机生成与更多案例后续版本接入'`（声明文案入共享常量，不散写）。
- `src/views/DrillView.vue`：`drill-intro` 内新增 **1 张** `.active-report.scenario-card`（`tabindex="0" role="group" aria-label="本期剧本"`），标题直接插值 `{{ fixture.scenario.title }}`，情境 = modifiers 为 true 的标签 join，起始对象 = `endpointName(map, scenario.start_building_id)`，时长/节点/上报数 = `formatSimTime(t_end)` / `nodes.length` / `ugc_reports.length`；`.intro-meta` 补「浏览器本地会话」→「全程约 5 分钟 · 免登录 · 浏览器本地会话 · 训练模拟」。主按钮文案本就是「开始一次推演」，`#start-drill` id 未动。
- `src/styles/drill.css`：`.scenario-card/.scenario-title/.scenario-facts/.scenario-note` 四条，沿用 `.active-report` 内嵌语言（inset 底、9px 圆角），未新造卡片体系。

### 8.2 §11.3-11 首屏声明 / 水印 / 主按钮 / 免登录（1440 与 375 同测）

| 项 | 1440 实测 | 375 实测 |
| --- | --- | --- |
| `#first-screen-notice` | 可见，1440×36，「精度声明训练级精度。建筑名称、分区与层数来自公开资料及校内确认（2026-11-17）；…不代表实测坐标或该校真实隐患分布。」 | 可见，375×79，同文 |
| `#page-watermark` | 可见，「训练模拟数据」81×19 | 可见，67×16 |
| `#start-drill` | 「开始一次推演」263×48 | 329×48，bottom=656 ≤ 812（首屏内完整可见） |
| `.intro-meta` | 「全程约 5 分钟 · 免登录 · 浏览器本地会话 · 训练模拟」 | 同 |

### 8.3 §11.3-12 场景卡数据全来自 fixture（7 项断言全过）

node 读 `fixtures/canonical-run.json` 与浏览器实测逐项比对（ALL MATCH）：

| 断言 | fixture 期望 | 卡内实测 |
| --- | --- | --- |
| title | 夜间宿舍火灾 · 暴雨内涝（训练样例） | 同（含「（训练样例）」后缀，未裁剪） |
| modifiers | night/heavy_rain=true，余 false | 「情境：夜间 · 暴雨」 |
| start_building_id | N7 → 萃园 7 幢（北 7） | 「起始对象：萃园 7 幢（北 7）」 |
| t_end | 300 | 「模拟时长 05:00」 |
| nodes.length | 14 | 「14 个回合节点」 |
| ugc_reports.length | 10 | 「10 条模拟上报」 |
| 卡数 | 仅 1 张 | `.scenario-card` count=1（两视口同） |

诚实标注实测：「本期 1 个预置剧本；AI 随机生成与更多案例后续版本接入」；卡 meta「本期剧本 / 训练模拟数据」。起始视图无 AI 已接入暗示（徽标见 8.5）。

**改标题即变（无硬编码）实证**：fixtures 为 A 冻结件，不在本仓库改。做法：把 `src/ fixtures/ index.html package.json tsconfig* vite.config.ts` 复制到 `$TEMP/campus-title-proof`（node_modules 用目录联接指向原仓库，只读共享），**仅在副本**把 scenario.title 改为「暴雨内涝复核（训练样例）」，副本内 `npm run build` 成功（index-DMCmc9OD.js），`vite preview --port 4174` 服务副本 dist，CDP 实测卡标题 = **「暴雨内涝复核（训练样例）」**（截图 d5-a-title-change-proof.png）。随后停服务、删联接与副本、关 4174 页签。仓库侧核验：`git status --porcelain fixtures/` 输出为空（冻结件零改动）；`grep -rn 夜间宿舍火灾 src/` 0 命中（标题只存在于 fixtures/canonical-run.json）。卡标题为模板直接插值，无任何 src 内副本字符串。

### 8.4 §11.3-13 五步无解说走通（每步下一步指引实测）

走查脚本 d5-a-02-walk.js（1440，daylight，全新加载后执行）：

| 步 | 操作 | 实测可见的下一步指引 |
| --- | --- | --- |
| 1 声明+卡 | 落地起始视图 | 精度声明 + 水印 + 场景卡 + 引导段「上报会陆续送到。读完消息，到地图上找楼栋或道路，再决定怎么处置。发现新线索时，可以改判。」 |
| 2 开始 | 点「开始一次推演」 | 上报面板「模拟上报」+「1 条待判读」chip + U1 原文 + 判读表单 legend「你的判断」+ 头部「推进时间 →」；指令面板空态「选中后会显示适用于该对象的指令。收到上报后，可直接处置。」 |
| 3 判读 | U1 选「真报」提交 | 「已记录「真报」」role=status；chip 变「0 条待判读」 |
| 4 动作 | #drill-target 选 N7（52 个候选）→ A1 → 下达 | #action-feedback「上报核查 · 执行中预计完成于 T+01:15」 |
| 5 推进+结算 | 连点「推进时间」13 次至末回合 | #round-next 消失；结算面板「结束推演」+ 指引「可选出最紧急的 3 条上报，也可以直接查看评分。」+ 按钮「结束推演并查看评分」 |
| 6 分数 | 点结束 | #score-breakdown 立即在；「本轮复盘」+ 摘要 chip「预置摘要 · AI 点评待接入」；判读正确 0/10（U1 在待核窗判真报，诚实计错） |

**返回/重置语义（§6.6）**：切「示例回放」再切回「推演」（KeepAlive），#score-breakdown 仍在（reviewStillReadable=true），已结算复盘可读性不丢。`#drill-reset` → 对话框「重置本轮推演？这会清除本轮的判读、指令与评分，并回到第一条上报。」→「清空并重置」后实测：回到 U1（「1 条待判读」、#round-next 在）、评分清除（scoreGone=true）。**resetDrill 语义与 D3/D4 一致未改**：重置回到第一条上报而非起始视图（started 只由 beginDrill 置 true，代码核实 DrillView.vue:75/573）；「回起始视图」= 全新加载，8.2/8.3 的 375 全新 nav 即起始视图实测。跨加载持久化 = D6（TC-05 待 D6），不在本日扩义。

### 8.5 §11.3-14 徽标互斥（Q10）

| 屏 | #badge-drill | #badge-replay |
| --- | --- | --- |
| 推演（起始与结算后同） | 「预置剧本，实时判定与评分」 | null（不渲染） |
| 示例回放 | null | 「示例回放」 |
| 切回推演 | 「预置剧本，实时判定与评分」 | null |

两徽标 v-if/v-else-if 互斥（App.vue:65-66），不同屏不混用；起始视图无 AI 已接入暗示。

### 8.6 §11.3-15 375 不溢出 / ≥44 / Tab 焦点环

- 375×812：docScrollW=375=innerW，bodyScrollH=812=innerH（无页面滚动）；report-panel scrollHeight=clientHeight=499（起始内容无需内滚）；主按钮 48px ≥44 且首屏内完整可见。
- 1440 同样无溢出（1440/1440、900/900）。
- **真实 Tab 键序**（CDP Input.dispatchKeyEvent，非程序 focus）：1 跳过链接 → 2 推演 → 3 示例回放 → 4 接口诊断 → 5 夜间配色 → **6 场景卡（ARTICLE.scenario-card）** → **7 #start-drill** → 8-10 图层开关 → 11+ 地图道路。第 6、7 站计算样式 outline 均 `2px solid rgb(32, 89, 71)`（daylight accent）；卡 `.matches(':focus-visible')=true`。焦点态截图 d5-a-card-focus-1440.png。
- 起始视图可点目标高度：卡 253px（1440）/208px（375）、主按钮 48px，均 ≥44。

### 8.7 截图（5 张，assets/）

d5-a-intro-day-1440.png、d5-a-card-focus-1440.png、d5-a-intro-day-375.png、d5-a-intro-ops-1440.png（ops 主题起始，拍后已切回 daylight 并实测确认）、d5-a-title-change-proof.png（副本改标题实证，4174）。

### 8.8 闸门（任务 A 后）

`d5-b-gates.log` 追加：check:d4 EXIT=0、typecheck:app EXIT=0、build EXIT=0（直跑取真退出码；55 modules，index-BWfvfQp9.css 75.76 kB/gzip 14.97、index-B_cFh0ta.js 290.29 kB/gzip 93.50）。

### 自纠 6（走查预期纠偏，非代码缺陷）

走查脚本原预期「清空并重置」后回到 drill-intro；实测回到第一条上报。读代码核实 resetDrill 从不置 started=false（D3 起即此语义，对话框文案也写明「回到第一条上报」），prompt §6.6 要求「resetDrill 语义不变」——故维持原语义，把「回起始视图」按全新加载口径实测（8.4）。另：harness getTab 取 /json/list 末页签，多页签时 eval 会落错页签（标题实证一度读到 4173 旧标题）；以关旧页签/直连 HTTP /json/new 处理，测量前均核对 location.href。临时副本目录删空后被已停服务进程句柄占用（Device or resource busy），内容已清空、联接已摘除，不影响仓库；会话收尾再试删（§9.9 复查：仍被占用，rmdir 退出码 32，留待系统清理）。

## 9. 体验与无障碍 + D2/D3/D4 回归（§11.5 项 25–29）

**想完成什么**：对比度、触控/键盘/reduced-motion、语义色、五断点、页脚声明+水印同屏全部重新实测（不沿用旧值），并复跑 D2/D3/D4 关键行为确认任务 0/A/B 改动无回归。
**在 Qoder 中做了什么**：CDP harness 新增 key（真实按键事件）、reducedmotion（媒体 emulation+动画扫描）、hooknav（同会话注册错误钩子+导航）三命令；编写 7 个测量脚本（对比度×2、断点×2、六态控制台扫、全量回归、页脚水印），全部在 4173 预览（index-B_cFh0ta.js / index-BWfvfQp9.css）上执行；未改任何 src 代码。
**如何验证**：以下每格均为本次窗口实测输出（JSON 留存于会话临时目录，关键值抄录如下）；截图 13 张入 assets/。

### 9.1 项 25 对比度（alpha 合成实测，双主题 × 复盘/起始两态）

方法：getComputedStyle 取前景色与祖先背景栈，逐层 alpha 合成后按 WCAG 相对亮度公式计算。复盘态 12 对（17 失误行、10 时间线行在场）；起始态 15 对（全新加载，场景卡+主按钮在场）。

复盘态（daylight / ops）：

| 对 | day | ops | 对 | day | ops |
| --- | --- | --- | --- | --- | --- |
| review-h2 | 13.52 | 13.58 | miss-kind | 7.31 | 8.05 |
| score-total | 13.52 | 13.58 | miss-text | 12.53 | 11.94 |
| metric-k | 6.26 | 8.28 | miss-basis | 5.80 | 7.28 |
| metric-v | 13.52 | 13.58 | summary-li | 13.52 | 13.58 |
| ledger-stamp | 6.26 | 8.28 | summary-chip | 6.75 | 6.39 |
| ledger-detail | 13.52 | 13.58 | review-muted | 6.26 | 8.28 |

起始态（daylight / ops）：

| 对 | day | ops | 对 | day | ops |
| --- | --- | --- | --- | --- | --- |
| notice-p | 5.80 | 7.28 | scenario-title | 12.53 | 11.94 |
| primary-btn | 8.14 | 9.62 | scenario-facts | 12.53 | 11.94 |
| intro-guide | 6.26 | 8.28 | scenario-note | 5.80 | 7.28 |
| intro-meta | 7.90 | 9.16 | scenario-ref | 7.31 | 8.05 |
| panel-h2 | 13.52 | 13.58 | scenario-training | 5.80 | 7.28 |
| footer-p | 5.70 | 9.28 | tab-active | 6.75 | 6.39 |
| theme-btn | 13.52 | 13.58 | watermark | 12.32 | 15.22 |
| chip（起始态无 chip，复盘态测） | 6.75 | 6.39 | | | |

- **基线命名对逐位吻合**：notice ops 7.28 / day 5.80；主按钮 ops 9.62 / day 8.14（prompt 行 31 基线）。chip/tab-active day 6.75 ≥ 基线 6.39、ops 6.39 ≥ 基线 5.70，未回退。
- 全部 27 个去重对 × 2 主题均 ≥4.5（AA）。本次扩样最低：day 5.70（footer-p）、ops 6.39（tab-active/summary-chip）；新增对（footer-p、miss-basis、scenario-note 等）低于 D4 抽样最低 6.39 但均过 AA，如实记录不粉饰。

### 9.2 项 26 触控 / 键盘 / reduced-motion

**触控 ≥44**（可见目标扫描：button/select/summary/a/input/[tabindex=0]/g[tabindex]）：

| 断点 | 态 | 可见目标 | <44 例外 |
| --- | --- | --- | --- |
| 920×900 | 起始/复盘 | 10 / 31 | 仅 app-skip 84×22 |
| 640×900 | 起始/复盘 | 10 / 31 | 仅 app-skip |
| 1440×575 | 起始/复盘 | 60 / 92 | app-skip + 46 个 SVG 道路形状（复测分类：46/46 均 SVGElement，HTML 控件 <44 数 = 0） |
| 640×480 | 起始/复盘 | 10 / 31 | 仅 app-skip |
| 390×844 | 起始/复盘 | 10 / 31 | 仅 app-skip |

app-skip 为隐藏至焦点的标准跳过链接（平时 translateY(-160%) 不可见）；SVG 道路为 D2 既有地图几何命中区，非 HTML 控件，不属本期整改范围。

**键盘**（CDP Input.dispatchKeyEvent 真实按键，非程序 focus）：Tab 序 1 跳过链接→2 推演→3 示例回放→4 接口诊断→5 夜间配色→6 场景卡→7 #start-drill，7 站 outline 均 `2px solid rgb(32, 89, 71)`。五步走查 + 两类失误跳转 + details 开合用 Tab/Enter/Space/Home/ArrowDown 完成；焦点定位仅用 .focus() 跳过地图 46 站 SVG Tab 链（如实注明）。末回合头按钮文案为「复盘」（回看时才「返回复盘」），按可见 rect 匹配后跳转成功（T+00:30 · U1）。

**reduced-motion**：emulation reduce 下 matchMedia=true、running animations=0、infinite CSS=0；no-preference 下同样 0/0——应用本无连续动画。守卫在 console.css:686-691（全局 animation/transition 关闭）+ drill.css:207-209（scroll-behavior:auto）。**发现**：console.css:682-684、1060-1062 共 6 个 @keyframes（dash-march/hazard-pulse/gate-ping/beacon-pulse/rain-fall/glow-breathe）全 src 零消费（grep 核实），属死代码；本期不顺手清理，记入 D6/D7 候选。

### 9.3 项 27 语义色（双主题计算值，与 D2 冻结逐位一致）

| token | ops | daylight |
| --- | --- | --- |
| --blue | #41b9ff | #0959a8 |
| --amber | #ffb224 | #7a5400 |
| --green | #37d67a | #126338 |
| --red | #ff5c5c | #a92019 |

### 9.4 项 28 五断点（起始 + 零操作结算复盘，每断点全新走查）

| 断点 | 溢出 | 布局 | 零操作总分 | 失误行 | 时间线 summary | 主按钮首屏 |
| --- | --- | --- | --- | --- | --- | --- |
| 920×900 | 无（920/920、900/900） | 单栏+dock | 15/100 | 17 行 minH62 | 46px | 可见（48px） |
| 640×900 | 无（640/640、900/900） | 单栏+dock | 15/100 | 17 行 minH62 | 46px | 可见 |
| 1440×575 | 无（1440/1440、575/575） | 三栏、无 dock | 15/100 | 17 行 minH62 | 46px | 折线下，面板内滚可达（scrollH542>clientH447；滚后 btnTop498/bottom546≤575，无页面滚动） |
| 640×480 横屏 | 无（640/640、480/480） | 单栏+dock | 15/100 | 17 行 minH62 | 46px | 折线下，内滚可达（scrollH425>clientH309） |
| 390×844 | 无（390/390、844/844） | 单栏+dock | 15/100 | 17 行 minH62 | 46px | 可见 |

五断点复盘面板均 overflowY:auto 内滚（scrollH 2459–2542），页面级 bodyScrollH 恒等于 innerH。截图 10 张：d5-x-bp{920x900,640x900,1440x575,640x480,390x844}-{intro,review}.png。

### 9.5 项 29 页脚声明 + 水印同屏（Q7）

| 态×视口 | 页脚徽标 | 页脚 p | 水印 | 同屏 | 顶部声明 |
| --- | --- | --- | --- | --- | --- |
| 复盘 1440×900 | 可见 h19 | 可见 h19（block） | 可见 h19 | ✓ | 可见 h36 |
| 复盘 375×844 | 可见 h17 | display:none（640 断点冻结规则） | 可见 h16 | ✓ | 可见 h79 全文 |
| 起始 375×844 | 可见 h17 | display:none | 可见 h16 | ✓ | 可见 h79 全文 |
| 起始 1440×900 | 可见 h19 | 可见 h19 | 可见 h19 | ✓ | 可见 h36 |

四组合页脚（徽标）与水印均同屏可见、无页面滚动；≤640 页脚长声明按冻结断点隐藏，由 #first-screen-notice 承载全文（复盘态也在场），任意截图可识别训练属性（水印「训练模拟数据」+ 徽标「预置剧本，实时判定与评分」+ 场景卡「训练模拟数据」角标）。截图：d5-x-footer-1440-intro.png、d5-x-footer-375-intro.png（复盘态页脚见 d5-x-bp390x844-review.png）。

### 9.6 控制台零错误（6 态 × 1440/375）

hooknav 同会话注入 window.__appErrors（console.error/window.onerror/unhandledrejection）后导航。s1 起始→s2 开始（待核+A1）→s3 复盘（13 推进+结算，该走查 42/100）→s4 示例回放→s5 接口诊断→s6 切回推演（KeepAlive 复盘可读）：**两视口六态 errors 全 []**。

### 9.7 D2/D3/D4 回归（全过）

- **D2 地图/路径**：20 栋/3 门/28 路段；基线路径 N7→N1 直达 1 段「萃园 7 幢至 1 幢」；封路改道→经 3 号门 2 段→再封 2 段后长绕 10 节点链→第 3 封后 unreachable「路径已计算，但当前路网无可通行路径」+「不可达原因：当前路网无可通行路径」（blocked/hazard 未合并）。
- **D2 诊断技术态 RoutePanel**：#diag-route-from=N7、to=N1 后双面板均技术态——badge「ready @300」、「1 段 · 路网计算长度 201.2 px」、segId R-N7-N1、「query 携带 28 条快照路段状态（blocked / hazard 分开传递）」；构造链面板 5 段 1267.6 px（R-N7-N1→R-N1-N2→R-N2-CN1→R-CN1-GYM→R-GYM-LIB）。截图 d5-x-diag-route-1440.png。
- **D3 播放/竞争/改判/回看/排序**：4× 倍速 t_sim 不变（T+00:30→T+00:30）；同秒 A2 二次派队拒绝「救援队在预计执行区间内余量不足（需要 1 队）」；U1 待核@30→真报+N7@130 改判成功（按钮「记录改判」）；回看只读 chip+「正在回看。回到当前回合可继续下达指令。」；排序一次后 chip「排序已记录 U2 → U8 → U4」、入口与表单消失。
- **D4 账本/评分**：结算 52/100，账本 8 行含 1 改判/1 拒绝/1 排序；排序判定「排序正确 U2→U8→U4 = 参考」；算术复核：甄别 10%×30=3、响应 100%×20=20、命中 40%×35=14、合规 100%×15=15，round(3+20+14+15)=52；命中权重 4+漏做 6=10。延迟完成显示（A2 预计 T+05:10>t_end，「已通过 · 进行中」）在任务 B 富走查已证（§6）。

### 9.8 截图清单（本节新增 13 张，assets/）

d5-x-bp920x900-{intro,review}.png、d5-x-bp640x900-{intro,review}.png、d5-x-bp1440x575-{intro,review}.png、d5-x-bp640x480-{intro,review}.png、d5-x-bp390x844-{intro,review}.png、d5-x-diag-route-1440.png、d5-x-footer-1440-intro.png、d5-x-footer-375-intro.png。

### 自纠 7（测量方法纠偏）

1. 起始态对比度首测落在 started 态（reset 不回起始，见自纠 6），场景卡各对 missing——改全新加载重测（9.1 起始表为第二次实测）。
2. Page.addScriptToEvaluateOnNewDocument 注册是**会话级**：跨 harness 调用注册的 hook 不生效，首轮扫荡「零错误」实为钩子未注入（typeof __appErrors=undefined）。新增 hooknav 同会话注册+导航后重扫，9.6 为真注入后的结果。
3. 首轮扫荡在 map 页签后出现一次页面冻结（eval 超时）；换页签后无钩子连走 4 遍均无法复现，判为 harness/浏览器瞬时挂起而非应用缺陷，如实记录不掩饰。
4. v-show 隐藏面板仍在 DOM：按存在性找「返回复盘」落空（末回合文案是「复盘」），改按文本+可见 rect 匹配。
5. 闸门日志首记 build 退出码经管道取到的是 tail 的码——直跑 `npm run build > log; echo EXIT=$?` 重取真值（§8.8 已正）。

## 10. 任务 C / D 授权与执行状态（本节随执行更新）

- **任务 C 授权（用户 AskUserQuestion 两轮确认）**：第一轮选定「复用 D2 站 + 公开匿名 + 用户约 2 名同学（B 提供网址与记录表）+ README 更新为客观进度」。执行中发现 D2 站（`01a1e975-1db9-72f3-8c5f-e01f8f858c83`）属 A 账号，B 账号 `list_sites` owned=0、`get_site` 两次 `sites_request_failed`——**不是删除，是跨账号不可达**，如实报阻塞。第二轮用户改选「新建静态站」：当前账号新建纯静态站，公开匿名策略沿用，D2 站零接触；八表 diff 记「不适用（新站无数据库依赖）」。
- **任务 C 已执行**：发布与公网复测全记录见 §11（published:true / committed:true / blockers:[]，匿名 200，甲 83 / 乙 44 桌面 + 375 全过，平台徽标避让修复后后复测）。
- **任务 D（2 名同学试用）待执行**：用户自行约 2 名同学；B 提供网址 + 三项记录表（§11.7），不解说不提示；T1 表 row1/2 只填真实返回结果，不预填、不代填、不用点击数推算；凑不齐 2 人如实记待补。
- TC-05（刷新重算）统一记「待 D6」。README 项目状态行按用户授权更新为客观进度（只写 D5 事实 + 凭证链接，不宣称达标，未验项留待验）。

## 11. 任务 C 首次公网部署（2026-11-20 实测）

### 11.1 站点与发布链（ID 为平台返回值，原样留存）

| 项 | 值 |
| --- | --- |
| 网址 | `https://campus-drill-sandbox-kqvhf8qsvw2.qoder.zone` |
| Site ID | `01a1f8cc-becd-768a-8512-beef169dcc46` |
| Project ID | `01a1f8cc-bec9-788f-b4dc-3093e3d14be4` |
| 访问策略 | public（新建站默认 private，经 `update_access_policy` 显式改公开；requestId `c4be2060-dc42-46c8-8e48-b06c662fdf0f`，confirmPublic:true） |
| 首次发布 action | `17a06791-f5af-4de4-a40d-fa514590a7e7`（createNewSite:true，slug campus-drill-sandbox，spa:false，databaseAccess:none，webDirectory dist） |
| 徽标避让修复 action（第 2 版，选择器 body:has 未生效，未采用为最终） | `e59991d2-438d-4409-a85c-5ea3b6df0f33`（published:true / committed:true） |
| **最终发布 action** | `8b274b70-b732-4088-9b72-dd38499ee626`（html:has 修正 + ≤575h 横屏水印再避让） |
| 最终 publishOperation | `01a1f8e2-4501-7032-b88f-f043afa31d8c`（state succeeded / committed true） |
| 最终状态 | readiness=publication_completed，published:true，blockers:[]，access_mode=public，lifecycle=active |
| 本地描述符 | `.校园应急桌面推演训练沙盘.qoder.site`（两次 descriptorStatus:pending 均按平台提示以同 action + 同输入重试 prepare 恢复写入，未重复上传） |
| D2 站 | 零接触（跨账号不可达，未删除未覆盖；/d2.html 与八表属 A 账号站点，本次不适用） |

### 11.2 发布前闸门与 index.html 收尾修正

- 修正：标题「校园应急桌面推演 · 接口诊断台」→「校园应急桌面推演训练沙盘」；`color-scheme` dark→light dark；内联底色 `#070b12`→`#eef2ee`（daylight 默认，消除加载暗闪）。修前/修后哈希见头部表。
- 闸门（[d5-b-gates.log](d5-b-gates.log)）：check:d4 EXIT=0；typecheck:app EXIT=0；build EXIT=0（55 modules）。徽标避让改动后重跑 check:d4 + build 均 EXIT=0。

### 11.3 产物哈希与匿名访问（curl 实测）

| 产物 | 本地 dist SHA-256 | 公网 served | 一致 |
| --- | --- | --- | --- |
| index.html（最终版） | f81108d7e86e311c52582702d1aa68f81d6b836d65bb5dbfa07b351318b14995 | e642e67a0060b3801fca83ba8f716c43a25d356152d5028dae6f62408143bb52 | **否——仅平台注入差异**（见 11.4） |
| index-DPy1AsQC.css | f795419058ed9743f0548ca1701513e76d6d9f97cced36f8c1f310c44b273273 | 同左 | 是（逐字节） |
| index-C7Qtm4oL.js | e8e65c87b38b0920fc5cd734992ae392f9b7c52528ba46e53d7f292ffdcdc5fa | 同左 | 是（逐字节；JS 内容哈希三版构建均相同，仅 CSS 变） |

- 匿名网关实测：private 阶段 `GET /` → **401** + `x-qoder-error: sites_gateway_login_required`；改 public 后 → **200** text/html（57618 bytes），CSS/JS 200 且 content-type 正确。「私有能开 ≠ 公网能匿名开」按实测记录，未假定。
- 首版（action 17a06791）产物：index-BWfvfQp9.css `1966dc94…`、index-B_cFh0ta.js `e8e65c87…`，served 与本地逐字节一致；served HTML `a9ffd6fe…` 与本地 `e18a9764…` 差异同为平台注入。

### 11.4 平台注入徽标与避让修复（修前实测 → 修复 → 修后实测）

- 公网 served HTML 比本地多一段 `<script data-qoder-watermark="v1" data-url="https://qoder.cn">`，运行后在 **`<html>` 下**（非 body）挂 `<qoder-sites-badge id="qoder-sites-watermark">`，shadow DOM 约 55KB，fixed 右下角（bottom 14px / right 10px / 147×32 / z-index 2147483647），含「隐藏水印」关闭按钮。平台资产，不可移除。
- **修前干扰（首版公网实测）**：1440×900 徽标压住本站「训练模拟数据」水印字形 81×12（页脚声明文字未压）；375×844 压住 dock「指令」按钮 118×12、「地图」29×12，水印字形 64×5。截图 `d5-c-pub-intro-1440.png` / `d5-c-pub-intro-375-prefix.png`。
- **修复（src/styles/drill.css，仅 `html:has(qoder-sites-badge)` 命中时生效，本地无徽标布局逐值不变）**：水印移左下（bottom 56px+safe-area / left 16px）；页脚右留 170px；≤920 workspace 底留 50px+safe-area 抬 dock；≤575h 水印再上移至 100px 避 dock。
- 弯路如实记：第 2 版用 `body:has(...)` —— 公网 DOM 实测徽标宿主 parentElement=HTML，选择器不命中（hasMatch:false），水印未动；改 `html:has` 并补横屏规则后为最终版。本地以 mock 徽标元素预验 1440×900 / 375×844 / 844×390 / 640×360 四视口全过再发布。
- **修后公网实测（最终版）**：

| 视口 | dock 底 vs 徽标顶 | 水印避让 | 字形重叠 | 控件盒重叠 | 页面滚动 | 控制台 |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | dock 隐藏（n/a） | 左下 (16,825)–(97,844) ✓ | 0 | 0 | 无（900=900） | [] |
| 375×844 | 766 ≤ 798 ✓ | (16,772)–(83,788) ✓ | 0 | 0 | 无（844=844） | [] |
| 844×390 横屏 | 340 ≤ 340 ✓ | (16,271)–(97,290) ✓ | 0 | 0 | 无（390=390） | [] |
| 375 示例回放态 | — | ✓ | — | 0 | 无 | [] |
| 375 接口诊断态 | — | ✓ | — | 0 | 无 | [] |

- 无徽标本地复核（375）：水印 right 7 / bottom 4、dock 底距 34、页脚右距 10px——与修前逐值一致，避让规则零副作用。

### 11.5 公网分支走查（最终版，甲 83 / 乙 44 × 桌面 / 375，全新加载逐次）

走查脚本按 fixture 事件序列逐条驱动（推进时钟到 t_sim → 判读/指令/排序），21 / 18 事件时钟全部精确命中（clockBad=[]），problems=[]：

| 走查 | 总分 | 四维（甄别/响应/命中/合规） | 关键明细 | 时间线 | 控制台 |
| --- | --- | --- | --- | --- | --- |
| 甲 1440×900 | **83 / 100** | 80 / 100 / 80 / 70 | 首报 U1 响应 45s 第 1 条；判读 8/10；定位 10/10；违规 2（第 14、20 条）；漏做 A4；排序 U2→U8→U4 正确 | 21 行 | [] |
| 乙 1440×900 | **44 / 100** | 60 / 0 / 50 / 55 | 首报 U1 响应 250s 第 16 条；判读 6/10；定位 9/10（U1 定位失误行在列）；违规 3（第 9、14、15 条）；漏做 A1/A4/A5/A6；失误行 12=4 漏做+4 判读+1 定位+3 违规 | 18 行 | [] |
| 甲 375×844 | **83 / 100** | 80 / 100 / 80 / 70 | 同上；dock 切换上报/指令面板走通 | 21 行 | [] |
| 乙 375×844 | **44 / 100** | 60 / 0 / 50 / 55 | 同上 | 18 行 | [] |

- 拒绝文案与 fixture 语义一致（实测反馈）：A6→CN1「对象楼栋必须已有灾情标注」；A6→N7 重复「同一楼栋不可重复断电」；A4→N7「同楼栋警戒必须先完成」。
- 首版（修前）公网亦完成同四组走查（83/44/83/44 全过，problems=[]）——评分与 CSS 无关，修前修后双份留证。
- 375 复盘态 dock/面板切换、失误行跳回、排序一次性等语义与本地 D4/D5 实测一致。

### 11.6 T2 首屏加载实测（不推算，注明网络与方法）

方法：CDP 全新导航，`performance.getEntriesByType('navigation')`；本机网络走 Clash 系统代理（127.0.0.1:7897），Edge headless 157。

| 样本 | 视口 | TCP+TLS | TTFB | domInteractive | loadEvent | HTML transfer |
| --- | --- | --- | --- | --- | --- | --- |
| 首版冷加载 | 1440×900 | 1702ms | 1273ms | 3825ms | **4852ms** | 57918B |
| 第 2 版加载 | 1440×900 | 1357ms | 1002ms | 6248ms | **6490ms** | 57918B |
| 最终版加载 | 1440×900 | 1895ms | 596ms | 4453ms | **4571ms** | 57918B |
| 最终版（复用连接） | 375×844 | 1287ms | 774ms | 2855ms | **2882ms** | 300B（304） |
| 本地 preview 对照 | 375 / 1440 | ~0 | ~0 | 12 / 11ms | **84 / 47ms** | 300B |

- **结论如实**：T2 目标 <3s，在本机跨境代理网络下冷加载实测 4.6–6.5s **未达标**；复用连接约 2.9s。应用侧成本 <100ms（本地对照），瓶颈为 TCP/TLS 握手（1.3–1.9s）+ 跨境 TTFB（0.6–1.3s）+ 57KB 注入 HTML 与 92KB JS 传输。不修饰数字；是否换网络环境复测由用户决定（试用者实际网络可能不同，T1 以试用者实测用时为准）。

### 11.7 任务 D 试用包（交用户转发，结果返回后填 T1）

网址：`https://campus-drill-sandbox-kqvhf8qsvw2.qoder.zone`

给试用者的话（照发，不解说不提示）：「打开这个网址，按页面上的指引自己走完一次推演，直到看见分数。不用问我怎么操作。结束后回我三件事：① 从打开网址到看见分数，实际花了多久（看表计时，含犹豫）；② 最耗时的一步是什么；③ 在哪里卡住或犹豫过（没有就写没有）。」

记录表（B 收齐后原样填 T1 row1/2，不代填）：

| # | 试用者 | 设备/浏览器 | 打开→看见分数用时 | 最耗时的一步 | 卡住/犹豫位置 | 可执行反馈（≥1 条/人） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 2 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |

- 任一用时 >3min：压缩最慢一步后重测（prompt §8）；凑不齐 2 人如实记待补，不编造第二人。

### 11.8 截图清单（本节新增 12 张，assets/）

修前：d5-c-pub-intro-1440.png（徽标压水印）、d5-c-pub-intro-375-prefix.png（徽标压 dock）、d5-c-pub-jia-review-375-prefix.png。
最终版：d5-c-pub3-intro-1440.png、d5-c-pub3-jia-review-1440.png、d5-c-pub3-yi-review-1440.png、d5-c-pub3-intro-375.png、d5-c-pub3-jia-review-375.png、d5-c-pub3-yi-review-375.png、d5-c-pub3-intro-landscape.png、d5-c-pub3-map-375.png、d5-c-pub3-diag-375.png。

### 自纠 8（部署过程纠偏）

1. 徽标宿主探测首版按 `[data-qoder-watermark]` 取到的是注入 script 本身（shadowRoot=null）报错——改扫真实 shadow host `qoder-sites-badge`。
2. `body:has(qoder-sites-badge)` 不命中：徽标挂在 `<html>` 下（hostParent=HTML 实测）。第 2 版发布后公网复测发现水印未动，改 `html:has` 重发；教训：选择器假设要先在目标 DOM 验证。
3. 横屏 844×390 mock 预验发现水印与 dock 视觉重叠（wmClearsDock:false）——补 ≤575h 水印 100px 规则后四视口全过。
4. 走查脚本总分解析 `replace(/[^\d]/g,'')` 把「83 / 100」拼成 83100 致 totalMatch 误报 false——改 `match(/^\d+/)`；总分文本本身两版均正确。
