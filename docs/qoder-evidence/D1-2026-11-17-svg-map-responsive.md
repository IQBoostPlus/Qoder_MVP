# D1 · 2026-11-17 · SVG 地图渲染 + 响应式栅格 + 首屏/页脚精度声明

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F1 地图、F4 时间轴/道路双状态、F8 空态、FR-3.3 / FR-8.3 训练标识、CD-01/04/05/06 |
| 状态 | 已完成（静态渲染）；点选 / 图层 / 路径线待 D2，实时评分待 D4 |

## 1. 想完成什么

把 T2 诊断页升级为真实地图页：自绘 SVG 渲染 fixture 8 栋 + GATE3 + 8 条路段，道路双状态图例随时间轴变化，响应式栅格（375/768/1280），首屏与页脚精度声明，训练水印与示例回放标识，路径/评分空态（留好 unreachable 分支）。这是 README 排期表里 B 的 D1 交付物。对应 T3。

**边界**：全部几何消费 `port.map` 与 `replayTo(...).roads`，不自己算坐标/长度/viewBox/路口位置；不实现 Dijkstra/规则引擎/评分器；不硬编码楼栋 id/名称/坐标/viewBox；空态与声明一律 import 常量。T3 不做点选、拖拽缩放、图层切换、路径线绘制（D2）。

## 2. 在 Qoder 中做了什么

- 读 §2 必读：handoff §2 地图/道路/空态段、`fixture-port.ts` 的 `MapView`/`RoadStatus`/`RouteResult`/常量、requirements §3/§6/§7.2/§7.4、quality CD-01～06 与 JW-08/09、A 凭证 §5.3、T2 凭证。
- 复跑 `npm run check:d1-v2` 确认基线后才动地图。
- 新建 [`src/config/categories.ts`](../../src/config/categories.ts)：8 类 category 配色/标签配置表（键是 category 值，非楼栋 id）+ 灾情标签映射。D2 补 20 栋零改动。
- 新建 [`src/components/CampusMap.vue`](../../src/components/CampusMap.vue)：自绘 SVG。`viewBox` 直接绑 `map.view_box_svg`、`preserveAspectRatio="xMidYMid meet"`、宽 100% 高按比例；不加额外 padding（A 已留白 20）。层序 画布→路段→楼栋→路口。路段 `<polyline>` 由 `road.geometry` 生成、长度读 `road_lengths_px`；双状态来自 `replayTo(...).roads`（自然灾情蓝色波纹描边+标签 / 正式封闭红色路障+seq），可叠加。楼栋 `<polygon>` 按 category 着色、标 name、`floors===null→「通高」`、容量带「≈」估算口径、`risk_tag` 非 null 显示风险标记；不显示任何高度。路口门形标记、`pointer-events:none` 不可点选、不计入楼栋数，位置取 `junction_positions`（处理 undefined）。
- 新建 [`src/components/MapLegend.vue`](../../src/components/MapLegend.vue)：类别色板 + 道路双状态文字说明（含「可叠加」）+ 校门说明 + 估算/非官方路名口径。
- 新建 [`src/components/RoutePanel.vue`](../../src/components/RoutePanel.vue) 与 [`ScorePanel.vue`](../../src/components/ScorePanel.vue)：空态分支。路径 `null→ROUTE_PENDING_TEXT`、`unreachable→ROUTE_UNREACHABLE_TEXT`（灰虚线，D2 分支留好）、`ready` 仅留结构不画线；评分 `null→SCORE_PENDING_TEXT` 不显示数字，非 null 才显示 total 与 `details.violation_event_seqs`。文案全部 import 常量。
- 新建 [`src/views/MapView.vue`](../../src/views/MapView.vue)：首屏 `PRECISION_NOTICE` 横幅 + 响应式栅格（桌面双列 / ≤1100 单列）+ 时间轴（run 选择、0～t_end 滑块、节点与 140/164/165 快捷时刻）驱动 `replayTo(runId,{t_sim})` + 道路双状态表 + 路径/评分面板 + 页脚（同一 `PRECISION_NOTICE` + 示例回放/训练模拟数据徽标同屏）。评分恒传第二参数 `snapshot.events`。
- 更新 [`src/App.vue`](../../src/App.vue)：顶栏加「训练地图 / 接口诊断」切换（默认地图），保留 T2 诊断页可回切；顶栏常驻两徽标。
- 扩展 [`src/styles/console.css`](../../src/styles/console.css)：触控目标统一 ≥44px（chip/select/number/range/topnav）。
- 浏览器实测 §6 全 23 项并截图（含 375px，用同源 iframe 真实触发媒体查询）。
- 过程中修正两处视觉问题：t=300 封闭标记与校门名重叠 → 双标记改为路线上方堆叠；风险文字溢出轮廓 → 改居中。另把说明文案里硬编码的路段 id/seq 移除，保持实现零数据字面量。
- 未改 A 冻结基线；未放宽 strict/noUncheckedIndexedAccess；未引入地图/UI/状态/测试库；未 commit/push；未改全局 git 配置。

- 对话截图：待用户补拍（见 §5）
- 生成结果截图：`assets/D1-svg-map-desktop.png`

## 3. 如何验证

### 3.1 基线 / 类型 / 构建（CLI）

```
$ npm run typecheck            # tsc --noEmit 通过
$ npm run build                # vue-tsc -p tsconfig.app.json 通过 + vite build
dist/index.html                   0.52 kB │ gzip:  0.37 kB
dist/assets/index-BV-moVnH.css   15.48 kB │ gzip:  3.66 kB
dist/assets/index-C5VOrcz0.js   140.74 kB │ gzip: 46.46 kB
✓ built in 217ms
$ npm run check:d1-v2          # exit 0，83/44/90 不变
D1-v2 fixture port validation PASSED
```

### 3.2 浏览器逐项实测（§6 1–23）

| # | 验收项 | 实测结果 | 截图 |
| --- | --- | --- | --- |
| 1 | check:d1-v2 全过 83/44/90 | exit 0 | §3.1 |
| 2 | typecheck + 前端类型过 | tsc / vue-tsc 均过；grep 无 `!`/as any/ts-ignore | §3.1 |
| 3 | build 成功 | dist 三文件 | §3.1 |
| 4 | viewBox === view_box_svg 无字面量 | DOM `viewBox="40 40 880 560"`、preserveAspectRatio xMidYMid meet；代码绑 `map.view_box_svg` | desktop |
| 5 | 8 栋全渲染顶点一致 + 计数 8 注明 D2→20 | 8 polygon 各 4 顶点；计数文案「D1 子集 8 栋 · D2 补至 20 栋渲染零改动」 | desktop |
| 6 | GYM 通高、无高度数值 | meta 含「通高 · 容量≈3000」；全页仅层数/通高，无高度 | desktop |
| 7 | GATE3 (500,520) 门形不可点选不计栋 | junction transform `translate(500, 520)`、门形 glyph、pointer-events none；楼栋计数 8 不含门 | desktop |
| 8 | 8 路段折线、R-CN1-GYM 4 点 | 8 polyline；点数 [2,2,2,2,2,2,4,2] | desktop |
| 9 | t140 积水标记无封闭 | hazardMarks=1 closedMarks=0；表「积水 @140 / 未封闭」 | t140 |
| 10 | t165 积水+封闭叠加可溯 seq17 | hazardMarks=1 closedMarks=1「封闭·seq17」；表「已封闭 @165 · seq17」；t164 仍「未封闭」 | t165 |
| 11 | 图例区分两状态 | 图例含「自然灾情」「正式封闭」「可同时存在」文字 | desktop |
| 12 | 路径区 ROUTE_PENDING_TEXT 无线 | 「路径计算待引擎接入」，无路径线 | t165 |
| 13 | 原始示例 83 / 偏离 SCORE_PENDING_TEXT | t300 → 83；t140/164/165 → 「实时评分待引擎接入」无数字 | desktop / t165 |
| 14 | 首屏声明逐字一致 | 首屏文本 === PRECISION_NOTICE（91 字），与页脚逐字相同 | desktop |
| 15 | 页脚同声明 ≥12px | 页脚 font-size 12.5px、色 #e9eef7（深底高对比 AA） | footer |
| 16 | 训练徽标 + 示例回放同屏 | 顶栏与页脚两徽标均 visible | footer |
| 17 | 一张截图含页脚+水印+示例回放 | footer-watermark.png 同屏含页脚声明 + 两徽标 | footer |
| 18 | 375px 无横滚/地图完整/声明可读/无截断 | iframe 375：scrollWidth 361≤371 无横滚；SVG 311×199 完整；单列；声明 13px/页脚 12.5px 可读 | 375 |
| 19 | 768 与 1280 正常 | 768 单列 SVG 676 无横滚；1280 双列 SVG 725 无横滚 | 768 |
| 20 | 触控 ≥44×44 | 375/768/1280 实测 minTouch=44 | 375 |
| 21 | 控制台无 error/rejection | 仅 vite debug | — |
| 22 | 无硬编码 id/名称/坐标/viewBox | grep 实现仅命中 A 的 contracts.ts 注释；B 代码零数据字面量 | — |
| 23 | 无新增地图/UI 库 | deps 仅 vue；dev 仅构建工具 | — |

截图清单（`assets/`）：D1-svg-map-desktop.png（t300 全景）、D1-svg-map-t140.png（积水态）、D1-svg-map-t165.png（双态+路径/评分空态）、D1-svg-map-375.png（手机单列）、D1-svg-map-768.png（平板）、D1-svg-map-footer-watermark.png（页脚声明+水印+示例回放同屏）。

**重要边界**：T3 是**静态渲染**。未验证点选交互、图层切换、路径线绘制（D2）与实时评分一正一反（D4）。`getRoute` 恒 null、`getScore` 仅完整基线返回分数，均为 fixture 静态行为，页面已常驻「示例回放 / 训练模拟数据」标注。

## 4. 结论与后续

- **结论**：B 的 D1 交付物完成——SVG 渲染 8 栋真实选点 + GATE3 + 8 路段、道路双状态随时间轴、响应式栅格、首屏/页脚精度声明、训练水印、路径/评分空态。23 项验收全部实测通过，基线未破坏。B 已追上 A，可进 D2 地图交互。
- **零改动承诺**：渲染只消费 `port.map` 数组与 category 配置表，D2 补 20 栋时渲染代码零改动（CD-01/04）。
- **后续**：D2 点选/图层/路径线/阻断标记 + 375px 深度实测；D4 实时评分。unreachable 分支与 ready 分支结构已在 RoutePanel 留好。
- **新缺口**：375px 下 SVG 按 viewBox 等比缩放后楼栋标签偏小（完整可见但不够易读），属 T3 不做缩放的已知取舍，D2 缩放/点选时改善；无其它接口缺口。

## 5. 待补凭证

- [ ] 用户补拍本轮 Qoder 对话截图（地图组件、双状态时间轴、空态、声明水印、响应式与两处视觉修正过程）。