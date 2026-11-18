# D2 · 2026-11-18 · 地图点选 + 灾情/警戒/救援队三图层 + 路径线 + 阻断联动 + 375px 实测

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F1 地图点选、F4 时间轴/道路双状态、F5 态势图层、F6 路径展示（渲染侧）、FR-4.1/FR-4.7、T5 无障碍、Q3/Q7/Q10、JW-09、CD-04、RE-06/RE-07、VS-01 |
| 状态 | 已完成（B 侧全部实测）；RE-06 阻断重算与 `getRoute` ready 真实接入待 A；实时评分待 D4 |

## 1. 想完成什么

D2 B 轨交付（排期表 D2 · B）：地图三类对象（楼栋/路段/路口）直接点选 + 键盘可达 + 详情面板；灾情/警戒/救援队三图层全部从 `replayTo` 快照派生、可独立开关；路径起终点选择器与 `RouteQuery` 传参（blocked 与 hazard 分离），ready/unreachable/null 三分支渲染；阻断标记与时间轴/详情/态势联动；375px 实测与双主题 WCAG AA 对比度。同时修掉读代码发现的五个缺口（§9.1～9.5）。

**边界**：只消费 `port.map` / `replayTo` / `getScore(runId, currentEvents)` / `getRoute(query)`，不实现 Dijkstra/规则引擎/评分器；A 的 `getRoute` 当前恒返回 `null`，ready 分支用**构造 RouteResult**在诊断台验证渲染，不冒充寻路结果；救援队只画静态标记，不 fabricate 行进轨迹；点选仅「选中查看」，不做 D3 动作提交/D4 实时评分。

## 2. 在 Qoder 中做了什么

- 对话截图：待用户补拍（见 §5）。
- 按提示词 `prompt/D2-B-map-interaction-layers.md` §13 顺序执行：先复跑 `check:d1-v2` 基线 → 修 §9.1 选择器 → 点选 → 图层 → 路径 → 阻断联动 → 375px/对比度 → 逐项验收。
- 新建 [`src/config/layers.ts`](../../src/config/layers.ts)：`LayerKey/LAYER_ORDER/LAYER_STYLE`（含图例 desc 文案）、`Selection` 联合类型、`deriveLayerMarks(snapshot)` 纯函数——灾情来自 `scenario_events.add_disaster_annotation`，警戒来自被接受的 A3（placing/ready 按 `t_sim` vs `completed_at_sim`），救援队来自被接受的 A2（enroute/arrived 同理），**无任何坐标/轨迹推算**。
- 新建 [`src/config/route-query.ts`](../../src/config/route-query.ts)：`buildRouteQuery(map, snapshot, from, to, t)` 把快照 `roads` 映射为 `road_segments`（`blocked = formally_closed`，`hazard` 独立字段）；`locationOptions`（楼栋 + 「无法定位」，JW-09）与 `endpointOptions`（楼栋 + 路口，路口注记「路网节点·非楼栋」）**两个候选集合分离**，无 `junctions[0]` 位置假设。
- 重写 [`src/views/MapView.vue`](../../src/views/MapView.vue)：统一 `selected/hovered`（`highlight = hovered ?? selected`）、window Esc 清除、图层开关栏（aria-pressed + 开/关文字）、常驻「选中详情 + 当前态势」两节 + 5 个 dock 页签（时间/道路/路径/图例/评分）；`chipTimes` 拆为剧本节点与演示时刻 [140,164,165]（虚线 chip + 「非剧本节点」标签，§9.5）；`getScore` 交互路径一律带第二参数，偏离→`SCORE_PENDING_TEXT`，不回退基线分。
- 改 [`src/components/CampusMap.vue`](../../src/components/CampusMap.vue)：楼栋 polygon 可点（§9.2）、路段加 22px 透明命中 polyline（§9.3）、路口 r24 命中区、全部可选对象 tabindex + Enter/Space + `:focus-visible` 焦点环、选中琥珀 sel-tag（颜色+文字双通道）、路径 casing 9px + 主线 4px 虚线行进动画、三图层标记（灾情「!」+ 事件 title 文字、警戒环 + 状态文字、救援「+」静态标记）。
- 改 [`src/components/ObjectDetail.vue`](../../src/components/ObjectDetail.vue)（跳转时刻按钮、设为起点/终点按钮）、[`src/components/RoutePanel.vue`](../../src/components/RoutePanel.vue)（ready/unreachable/null 三分支，常量 import，长度文案「图上长度 … px」）、[`src/components/MapLegend.vue`](../../src/components/MapLegend.vue)（三图层 + 路径线 + 选中说明，颜色+文字）、[`src/components/OccupancyBars.vue`](../../src/components/OccupancyBars.vue)（占用条并列）。
- 扩 [`src/views/DiagnosticView.vue`](../../src/views/DiagnosticView.vue) 至 10 面板：05 传参核对（road_segments blocked/hazard 分列）、08 **构造路径**（真实几何拼接链 R-N7-N1→R-N1-N2→R-N2-CN1→R-CN1-GYM→R-GYM-LIB，ready/unreachable/none 三态切换，徽标「构造输入·非寻路结果」）、09 **CD-04 程序化合成 20 栋**（5×4 网格 SYN-B01..20 + 3 路口 + 29 路段，走 `buildMapView` 同一渲染管线，徽标「程序化合成数据·非真实校园」）、10 JW-09 候选集合泄漏检查。
- 改 [`src/styles/console.css`](../../src/styles/console.css)：新增图层栏/态势列表/chip 分组/road-pick/路径控件样式全部复用 token；新增 `--route-line/--route-casing`（随主题自动翻转）；**日光主题强调色加深过 AA**（--red #a92019、--blue #0959a8、--green #126338 及 soft/类别色）；≤900 媒体查询补 `.stage-col .map-stage{flex:none}` 修 375px 舞台塌缩、详情/态势常驻；≤400 补页签/图层开关换行。
- 人工修正：日光主题对比度首测 3 处 <4.5 → 加深 token 后复测全过；SVG 对比度测量改读 `fill` 并取 `text` 子元素；375px 舞台 260px 塌缩 → flex:none 修复至 373.5px。

## 3. 如何验证

### 3.1 CLI 基线（完整命令与输出）

```
$ npm run typecheck
> tsc --noEmit
EXIT=0

$ npm run typecheck:app
> vue-tsc --noEmit -p tsconfig.app.json
EXIT=0（无 ! 断言 / as any / ts-ignore；strict + noUncheckedIndexedAccess 未放宽）

$ npm run build
dist/assets/index-CaK6u2qW.css   35.64 kB │ gzip:  7.23 kB
dist/assets/index-BAVyYMQS.js   178.87 kB │ gzip: 57.78 kB
✓ built in 231ms

$ npm run check:d1-v2
replay: jia seq20 5 accepted/4 rejected/5 occupancy; R-N7E flood at 140, closed at 165
rejections: jia [14,20]; yi [9,14,15]
score: jia 83; mutation=>null; 1x/4x response=45s
route: null (pending); hardcode scan clean; README precision notice matched
EXIT=0
```

83/44/90 契约值未动；A 冻结文件（contracts.ts / fixture-port.ts / fixtures/*.json / schema.sql / validate-*.ts）零改动。

### 3.2 §10 逐项实测（浏览器实操，Chrome via Qoder Browser Connector，dev server http://127.0.0.1:5173/）

| # | 验收项 | 结果 | 证据/实测值 |
| --- | --- | --- | --- |
| 1 | check:d1-v2 全过，83/44/90 不变 | ✅ | §3.1 输出，EXIT=0 |
| 2 | typecheck + typecheck:app 通过，无 ! 蒙混 | ✅ | §3.1，双 EXIT=0 |
| 3 | build 成功 | ✅ | 231ms，CSS 35.64 kB / JS 178.87 kB |
| 4 | 控制台 0 error / 0 rejection（桌面+移动） | ✅ | 全程 sweep 后 list_console_messages 仅 10 条 vite debug（connecting/connected/hot updated），0 error 0 warning |
| 5 | 点楼栋→选中+详情；再点取消；空白取消 | ✅ | N7 点选→详情+sel-tag+清单同步；二次点击与空白点击均清除（DOM 复核 selected=null） |
| 6 | 点路段→选中+详情含阻断原因 | ✅ | R-N7E t=165 详情含「封闭·seq17」+「积水@140」+ block_reason；截图 d2-desktop-road-dualstate-165.png |
| 7 | 点路口→详情，楼栋计数不变，不进定位候选 | ✅ | GATE3 选中详情显示连接路段；楼栋计数不变；面板 10 泄漏检查「无」 |
| 8 | Tab 遍历 + Enter/Space + Esc + 焦点环两主题 | ✅ | press_key Tab 真实焦点 :focus-visible 环 opacity=1（两主题）；Enter/Space 选中；window 与元素级 Esc 均清除 |
| 9 | 选中态文字标识不只靠颜色 | ✅ | sel-tag 文字「选中」+ 详情面板对象名 + aria-label 含名称与状态；道路表/清单 aria-pressed + 高亮行文字 |
| 10 | 定位候选 = 楼栋 + 无法定位（JW-09） | ✅ | 面板 10：loc-leak=无，hasUnlocatable=存在；路段/路口不在其中 |
| 11 | 端点候选 = 楼栋 + 路口（注记非楼栋） | ✅ | route-to 下拉含 GATE3「3 号门（近北区）· 路网节点·非楼栋」 |
| 12 | t=80 无灾情标记；t=90 出现含 title 文字 | ✅ | t=80 marks=0 + 态势空态文案；t=90 mark-disaster=1，可见文字「北 7 三层确认为真实火情 @90」；截图 t80/t90 对比 |
| 13 | 甲 t=130 后警戒「已就位 @130」；100～130「布设中」 | ✅ | deriveLayerMarks 按 completed_at_sim=130 判态，t=110 布设中 / t=130 已就位（DOM 复核文字） |
| 14 | 甲 t=160 后救援「已到达 @160」；100～160「在途 · 预计 @160」 | ✅ | 同上按 completed_at_sim=160；t=130 在途 / t=165 已到达（DOM 复核） |
| 15 | 乙 t=250 占用同含 rescue_team + barrier_team | ✅ | run-yi t=250 两条占用条并列 100%（seq16 220→280 / seq17 250→280）；截图 d2-375-ops-time-occupancy.png |
| 16 | 救援图层无 fabricated 行进折线 | ✅ | 救援仅静态「+」标记 + 状态文字；代码无轨迹插值；截图可见无折线 |
| 17 | 三图层独立开关，关闭只影响视觉 | ✅ | 逐层关闭→对应标记消失、态势列表同步门控、按钮文字「关」；快照/评分读数不变（DOM 复核） |
| 18 | 图例含三图层+路径线，颜色+文字 | ✅ | MapLegend 三组 LAYER_STYLE.desc + 路径 swatch（casing+虚线）+ 选中 swatch |
| 19 | 选择器无 junctions[0] 假设；同起终点禁用提示 | ✅ | route-query.ts 按 id 查找；from=to 时 #route-degenerate alert 显示且查询置 null |
| 20 | RouteQuery 携带快照 blocked/hazard 分离 | ✅ | 面板 05 表格：t=165 R-N7E blocked=true、hazard=积水 分列；t=164 blocked=false、hazard=积水 |
| 21 | 未交付显示 ROUTE_PENDING_TEXT 无路径线；ready 用构造对象验证 | ✅ | 主视图路径页签显示「路径计算待引擎接入」、无路径线；面板 08 构造 ready：casing 9px + 主线 4px、两端点、5 段 road-route 覆盖、图上长度 637.8 px、逐段通行徽标 |
| 22 | A 交付后 N7→GATE3 t<140 走 R-N7E、t≥165 改道（RE-06） | ⏳ 待 A | getRoute 恒 null，无法实测真实改道；渲染/传参/阻断标记侧已就绪。**不写成已验收** |
| 23 | unreachable 与 null 文案颜色均不同 | ✅ | 面板 08 三态切换：unreachable 虚线红 +「路径已计算，但当前路网无可通行路径」；null 灰 +「路径计算待引擎接入」 |
| 24 | 长度文案「图上长度 … px」，无实际距离/耗时 | ✅ | RoutePanel 仅「图上长度 637.8 px」（构造链）；全文无米/分钟表述 |
| 25 | 375px 上下分栏、无横滚、地图完整、声明可读、开关可点 | ✅ | 同源 iframe 375×812 真实媒体查询：单列 347px、舞台 373.5px、scrollWidth=375、页脚声明可读、图层开关可点 |
| 26 | 375px 三图层全开仍可读 | ✅ | 截图 d2-375-daylight-panorama.png / d2-375-ops-selected.png（三图层全开） |
| 27 | 触控目标 ≥44×44px | ✅ | 实测图层开关 111.7×44、页签/按钮 44、road-pick 44.6、road-hit 命中 stroke 22px（直径 44）、junction-hit r24（直径 48） |
| 28 | 两主题对比度实测达 AA | ✅ | §3.3 两表全部 ≥4.5:1 |
| 29 | 一张截图同屏含页脚声明+示例回放+训练模拟数据 | ✅ | d2-desktop-map-selected.png：页脚精度声明 + 「示例回放」+「训练模拟数据」双徽标同屏 |
| 30 | 无硬编码楼栋 id/名称/坐标/viewBox | ✅ | check:d1-v2 hardcode scan clean；字面量仅存在于诊断台构造数据（CONSTRUCTED_CHAIN / SYN-*）与测试断言 |
| 31 | CD-04 20 栋零改动渲染 | ✅ 构造验证 | 面板 09：合成 20 栋 + 3 路口 + 29 路段经 buildMapView → viewBox "48 56 892 634"，SYN-B13 点选正常，渲染代码零改动。**这是构造验证，不是真实数据验收**；真实 20 栋待 A fixture |
| 32 | 无新增依赖 | ✅ | package.json dependencies 仍仅 vue ^3.5.45；无 router/状态库/UI 库/地图库/测试框架 |

### 3.3 对比度实测表（WCAG AA ≥4.5:1；t=165、路段选中态；rgba 已按祖先背景链合成，SVG 取 text 子元素 fill）

**夜航指挥 ops（默认）**

| 元素 | 比值 | 元素 | 比值 |
| --- | --- | --- | --- |
| 页脚声明 ribbon-text | 16.93 | 灾情标记文字 | 9.02 |
| badge-blue（积水） | 7.60 | 警戒标记文字 | 10.93 |
| badge-amber（警戒/占用） | 9.07 | 救援标记文字 | 10.38 |
| badge-red（封闭） | 5.79 | 封闭标记文字 | 6.51 |
| 图层开关·灾情 开 | 7.60 | 积水标记文字 | 9.02 |
| 图层开关·警戒 开 | 9.07 | 态势列表文字 | 16.06 |
| 图层开关·救援 开 | 8.64 | 选中 sel-tag 文字 | 10.93 |

**教室投影·日光 daylight（token 加深后复测）**

| 元素 | 比值 | 元素 | 比值 |
| --- | --- | --- | --- |
| 页脚声明 ribbon-text | 13.30 | 灾情标记文字 | 5.97 |
| badge-blue（积水） | 5.15 | 警戒标记文字 | 5.80 |
| badge-amber（警戒/占用） | 5.69 | 救援标记文字 | 6.26 |
| badge-red（封闭） | 5.92 | 封闭标记文字 | 6.17 |
| 图层开关·灾情 开 | 5.15 | 积水标记文字 | 5.97 |
| 图层开关·警戒 开 | 5.05 | 态势列表文字 | 14.04 |
| 图层开关·救援 开 | 5.41 | 选中 sel-tag 文字 | 5.80 |

首测日光 badge-red 4.16 / 灾情开关 3.95 / 救援开关 3.99 不达标 → 加深 `--red/--blue/--green`（含 soft 与 cat-teaching/cat-library）→ 上表复测全过。

### 3.4 375px / 320px 实测（同源 iframe 真实触发媒体查询）

| 指标 | 375×812 | 320 |
| --- | --- | --- |
| 布局 | 单列 347px，上下分栏 | 单列 |
| document.scrollWidth | 375（无横滚） | 320（无横滚） |
| 地图舞台高度 | 373.5px（flex:none 修复后；修复前塌缩 260px） | 正常 |
| 页签/图层开关 | seg 换行、开关 111.7×44 可点 | seg 两行 102px |
| 道路表 | 313px 宽，无横向滚动 | 容纳 |
| 详情+态势 | 常驻可见（不随页签隐藏） | 常驻 |
| 占用条 | 6 行完整 | 完整 |

### 3.5 关键截图（assets/，15 张）

| 文件 | 内容 |
| --- | --- |
| d2-desktop-map-selected.png | 桌面 ops t=300 N7 选中：三图层全开 + 详情 + 态势 + 页脚声明 + 示例回放/训练模拟数据双徽标同屏（#29） |
| d2-desktop-t80-no-disaster.png | t=80 灾情可见性切割：0 标记 + 态势空态（#12 反例） |
| d2-desktop-t90-disaster.png | t=90 灾情标记 + 「北 7 三层确认为真实火情 @90」（#12 正例） |
| d2-desktop-t164-hazard-only.png | t=164 仅积水、未封闭（道路双态·危害先行） |
| d2-desktop-road-dualstate-165.png | t=165 R-N7E 选中：封闭·seq17 + 积水@140 双标记 + 阻断原因详情 |
| d2-daylight-map-selected.png | 日光主题 t=165 路段选中（token 加深后复拍，两主题对比） |
| d2-diag-constructed-ready.png | 面板 08 构造 ready 路径：casing+虚线、637.8 px、徽标「构造输入·非寻路结果」 |
| d2-diag-constructed-unreachable.png | 面板 08 unreachable：虚线 + ROUTE_UNREACHABLE_TEXT |
| d2-diag-cd04-20.png | 面板 09 合成 20 栋 + 3 路口 + 29 路段，徽标「程序化合成数据·非真实校园」 |
| d2-375-daylight-panorama.png | 375 日光全景：三图层全开 + 页脚声明（#25/26） |
| d2-375-daylight-selected-detail.png | 375 日光选中详情常驻 |
| d2-375-daylight-route-tab.png | 375 日光路径页签：ROUTE_PENDING_TEXT 空态 |
| d2-375-ops-selected.png | 375 ops 三图层 + 选中 |
| d2-375-ops-roads-tab.png | 375 ops 道路表 313px 无横滚 |
| d2-375-ops-time-occupancy.png | 375 ops 乙 t=250 双占用条并列（#15） |

### 3.6 §9 五个缺口修复说明

| 缺口 | 修复 | 验证 |
| --- | --- | --- |
| 9.1 `junctions[0]` 位置假设 | route-query.ts 按 id 查找；端点候选 = 楼栋 + 全部路口（注记非楼栋）；默认终点为空串而非第一个路口 | #19/#11 实测；面板 10 候选集合检查 |
| 9.2 楼栋 polygon 不可点 | polygon 加 pointer 命中 + tabindex + Enter/Space，点击派发 select | #5 实测 N7 点选 |
| 9.3 路段命中区 7px 太窄 | 叠加 22px 透明 pointer-events:stroke 命中 polyline（视觉线宽不变） | #27 实测 stroke=22px；375 手指可点 |
| 9.4 救援队 fabricate 路径 | 只画静态「+」标记 + 在途/已到达文字，无轨迹插值代码 | #16 实测 + 代码审查 |
| 9.5 chipTimes 含非节点时刻 | 拆 nodeTimes（剧本 14 节点）与 demoTimes [140,164,165]，后者虚线 chip + 「道路双状态演示时刻（非剧本节点）」分组标签 | 时间页签截图可见分组 |

## 4. 结论与后续

B 侧 D2 目标达成：§10 共 32 项，**30 项 B 已实测通过，1 项构造验证通过（#31，非真实数据验收），1 项待 A（#22 RE-06）**。基线三命令全过，控制台零错误，双主题 AA 全过，375/320 无横滚。

**明确区分**：

- **B 已实测**：点选/键盘/候选集合、三图层派生与开关、可见性切割（t=80/90）、道路双态（164/165）、占用并列、路径三分支渲染与传参、阻断联动、375px、对比度。
- **待 A（不写成已验收）**：#22 RE-06 阻断后真实改道重算（`getRoute` 恒 null）；ready 分支真实寻路接入（当前仅构造对象验证渲染）；真实 20 栋 fixture（当前仅合成数据验证渲染管线）。另注：GATE3 当前 degree=1（仅 R-N7E），t≥165 封闭后 N7→GATE3 在现有 8 路段拓扑下可能无替代路径——需 A 在 20 栋邻接补齐后确认改道存在性，B 不自行补路段。
- **待 D4**：实时评分（当前静态 `getScore` 带第二参数，偏离→SCORE_PENDING_TEXT，全匹配→44/83 已实测）。

D1 前端 + D2 全部改动**仍未提交**（等用户指示，不自行 commit/push）。

## 5. 待补凭证

- [ ] 本次 D2 Qoder 对话截图（用户手动补拍，建议命名 `assets/d2-map-interaction-layers-chat-01.png` 起）