# D1 · 2026-11-17 · 指挥舱改版：整屏零滚动 + 视觉重做

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F1 地图渲染 / F2 道路双状态 / F6 响应式（见 README 功能清单） |
| 状态 | 已完成 |

## 1. 想完成什么

用户对 T3 首版界面提出两点硬意见：「界面好丑」「网页不应该有上下拉动」。本步骤把地图页从「长文档流」重做为**整屏指挥舱**：页面本身在任何视口都不产生纵向/横向滚动（`body{overflow:hidden}` + `100dvh` 四行 deck 栅格），滚动只发生在舱内区域（情报轨 / 诊断页 / 移动端主区），且滚动条用项目自己的配色绘制；同时重做地图与舱体的视觉语言（HUD、角标框、分区水印、路段流动虚线、灾情脉冲、校门 ping），保留 T3 全部验收项（viewBox 来自 `port.map`、8 栋 / GATE3 / 8 路段、双状态、图例、逐字声明、水印、空态、375px 无横滚、触控 ≥44px、不硬编码楼栋数据）。

## 2. 在 Qoder 中做了什么

- 指令：用户原话「可是现在的界面好丑，这就是最终界面？而且网页不应该有上下拉动」，据此下达整屏化 + 视觉重做规格，约束沿用 T3 补充条款（不改 A 冻结文件、不引新依赖、不另写空态文案、不 commit/push）。
- 生成/修改（均为 B 轨自有文件）：
  - `src/styles/console.css`：新增 deck 壳（`grid-template-rows:auto auto minmax(0,1fr) auto`、`height:100dvh`、`overflow:hidden`）、ribbon 首屏声明条、statusbar 页脚声明条、map-stage 舞台（径向渐变底 + 四角框）、HUD 三角落、情报轨内滚 + 自定义滚动条、入场 rise-in、`prefers-reduced-motion` 降级、≤1100px 与 ≤900px 断点。
  - `src/App.vue`：重写为 deck 壳；topbar（品牌 + 视图切换 + 水印徽章）、`#first-screen-notice` ribbon 与 `#map-footer-notice` statusbar 均逐字渲染 `PRECISION_NOTICE`；诊断页放入 `.diag-scroll` 内滚容器。
  - `src/views/MapView.vue`：重写为「舞台 + 情报轨」；HUD 显示 SIM CLOCK / 分支与 run_id / 路网计数 / viewBox / 灾情与封闭计数；情报轨四舱（01 图例 / 02 时间轴 / 03 道路双状态 / 04 路径评分），移动端 `.seg`  tab 切换单舱显示；逻辑仍全部走 `port.replayTo / getScore(恒传第二参数) / getRoute`。
  - `src/components/CampusMap.vue`：视觉升级——分区水印（由 `buildings.zone` 聚合）、楼栋 sheen 渐变、开放路段流动虚线、灾情脉冲 + 辉光、封闭标记上移避免压校门名、标签 paint-order 描边保证可读、校门 ping 动画；几何仍全部来自 `port.map`。
- 人工/迭代修复（实测发现后当场修）：
  1. 375px 下地图舞台被挤到 **16px 高**（地图几乎不可见）→ 移动端改为主区内部滚动 + `.map-stage{height:46dvh;min-height:260px}`，复测 svg 高 **352px**。
  2. 375px 下 HUD 左上（分支/run_id）与右上（D1 子集/viewBox）文字重叠 → 移动端隐藏 HUD 次要行与顶栏重复徽章，复测 tl.right=121 < tr.left=196，无重叠。
- 对话截图：待补（见 §5）
- 生成结果截图：`assets/D1-console-redesign-desktop.png`、`assets/D1-console-redesign-375.png`、`assets/D1-console-redesign-375-t165.png`、`assets/D1-console-redesign-768.png`、`assets/D1-console-redesign-desktop-t165.png`

## 3. 如何验证

浏览器实操（browser-use MCP，同源注入 iframe 触发真实媒体查询；range 用原生 value setter + `input` 事件；每次状态变更后等待 Vue 异步渲染再读数）。

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 桌面整屏零滚动 | 浏览器实操 | `body.overflow=hidden`；`document.scrollHeight=1191 == innerHeight=1191`；`pageVScroll=false` |
| 桌面舞台尺寸 | 浏览器实操 | svg 689×959；分区水印 3 组；楼栋 8；路段 8；`.seg` display=none（桌面四舱全显） |
| 情报轨内滚 | 浏览器实操 | 视口较矮时 `rail.scrollHeight > clientHeight` 成立，滚动仅发生在轨内 |
| 375×812 零页面滚动 | iframe 实测 | `pageVScroll=false`、`pageHScroll=false`；主区内部滚动 `mainScroll=true`（设计内） |
| 375 地图可见（修复前后） | iframe 实测 | 修复前 svgH=**16**（缺陷）→ 修复后 svgH=**352**、stageH=374 |
| 375 HUD 不重叠 | iframe 实测 | tl.right=121 < tr.left=196，`overlap=false` |
| 375 底部舱 tab | iframe 实测 | 时间轴/道路/图例/评分 四 tab 各自仅显示对应 `.rail-sec`（逐一点击实测） |
| 375 触控与字号 | iframe 实测 | 可见可触元素最小高度 **44px**；ribbon 12px、页脚声明 12.5px |
| 768×812 | iframe 实测 | svgH=352；`.seg` flex；`pageVScroll=false`；8 栋 / 8 路段 |
| 双状态 t=140 | 浏览器实操 | R-N7E「积水 @140 / 未封闭」；HUD 灾情 1 封闭 0；标记 hazard=1 closed=0 |
| 双状态 t=164 | 浏览器实操 | R-N7E「积水 @140 / 未封闭」；HUD 灾情 1 封闭 0；标记 hazard=1 closed=0 |
| 双状态 t=165 | 浏览器实操 | R-N7E「积水 @140 / 已封闭 @165 · seq17」；HUD 灾情 1 封闭 1；标记 hazard=1 closed=1（桌面与 375 各测一次） |
| 评分·原始示例 | 浏览器实操 | `#score-live` 总分 **83**，四指标 80/100/80/70，违规明细 [14, 20] |
| 评分·偏离示例 | 浏览器实操 | t=165 截断事件后 `#score-pending`「实时评分待引擎接入」，**无基线回退** |
| 路径空态 | 浏览器实操 | `#route-pending`「路径计算待引擎接入」（unreachable 分支保留于 RoutePanel） |
| 声明逐字 | 浏览器实操 | `#first-screen-notice` 与 `#map-footer-notice` 文本长度均 **91**（=PRECISION_NOTICE），同屏可见 |
| 诊断页内滚 | 浏览器实操 | `.diag-scroll` contentH=5791 / clientH=1210，可滚到底（scrollTop+clientH==scrollHeight），页面仍零滚动 |
| 控制台 | 控制台 | 仅 vite HMR debug 日志，**无 error / warning** |
| 类型与构建 | CLI | `vue-tsc --noEmit` 通过；`vite build` 成功：`index-B29Na-UY.css 21.26 kB` / `index-BbF5iWlo.js 142.48 kB` |
| 冻结基线 | CLI | `npm run check:d1-v2` **EXIT=0**，83/44/90 不变（完整输出见下） |

- 验证截图：`assets/D1-console-redesign-desktop.png`（桌面整屏，宽视口实拍）、`assets/D1-console-redesign-375.png`、`assets/D1-console-redesign-375-t165.png`（移动端双状态）、`assets/D1-console-redesign-768.png`、`assets/D1-console-redesign-desktop-t165.png`
- 取景说明：验证过程中应用内 Browser 面板宽度发生变化（一度 482px），故 1280/768 的补充截图采用**同源 iframe 按目标宽度渲染后等比缩放取景**（媒体查询按 iframe 自身宽度生效，布局真实）；桌面全分辨率实拍为 `D1-console-redesign-desktop.png`。缩放图仅用于布局凭证，字号以实测值为准。

```
$ npm run check:d1-v2
> campus-emergency-drill@0.1.0 check:d1-v2
> npm run check:d1 && tsx scripts/validate-d1-v2.ts

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
map: 三投影深度相等；GATE3=(500,520)；viewBox=40 40 880 560；8 条路段长度>0；三点折线=10；平移/改名由输入决定
visibility: t=80 U1/U3/U2/U4/U5；t=300=10；U1 在 30/90/100 的窗口正确
replay: seq20=5 accepted/4 rejected/5 占用；U1 改判指向 seq2；t=140/164/165 封路状态正确
rejections: 甲 CN1×2/N7×2、违规 [14,20]；乙 A4×3、违规 [9,14,15]
score: 83；改动/删减/新增/重排/未知 run 均 null；1×/4× 模拟时刻一致且响应 45s
route: 静态 null + 空态文案；输入未被修改；专名/坐标/固定 viewBox 扫描通过；README 精度文案一致
D1-v2 fixture port validation PASSED
map: projections equal; GATE3=(500,520); viewBox=40 40 880 560; roads=8
visibility: t=80 U1/U3/U2/U4/U5; t=300=10; U1 30=待核, 90=真报
replay: jia seq20 5 accepted/4 rejected/5 occupancy; R-N7E flood at 140, closed at 165
rejections: jia [14,20]; yi [9,14,15]
score: jia 83; mutation=>null; 1x/4x response=45s
route: null (pending); hardcode scan clean; README precision notice matched
A 接口已测，B 页面待测（无页面，不以字符串存在替代 UI 验收）
EXIT=0
```

## 4. 结论与后续

- 达成：页面级零滚动（桌面 / 375 / 768 三档实测 `pageVScroll=false`、`pageHScroll=false`），滚动全部收敛到舱内并配自定义滚动条；视觉从文档流升级为指挥舱（HUD / 角框 / 水印 / 动效），T3 全部验收项保持通过，冻结基线 exit 0。
- 过程中发现并修复两个真实缺陷：375px 地图舞台塌缩 16px、375px HUD 文字重叠；均已复测关闭。
- 已知缺口（沿用 T3 记录，不新增）：375px 下楼栋标签字号偏小（地图为等比缩放的训练级示意图），D2 点选交互落地时以抽屉/浮层补足详情，不靠放大标签。
- 边界声明：本步骤仍为 fixture 静态回放渲染；点选/拖拽缩放属 D2，实时评分属 D4，未因改版提前实现或伪造。
- 未执行 git commit / push（本地合并提交仍未推送，遵守约束）。

## 5. 待补凭证

- [ ] 用户补拍：本次「界面好丑 / 不应上下拉动」反馈与改版指令的 Qoder 对话截图（`assets/D1-console-redesign-chat-01.png`）
- [ ] 用户补拍：改版后指挥舱首屏在用户自己浏览器中的确认截图（`assets/D1-console-redesign-chat-02.png`）