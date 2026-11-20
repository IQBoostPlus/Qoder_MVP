# D4+ · 2026-11-19 · B 轨 · 夜战 HUD 整页重设计（回应「页面太丑」）

## 1. 想完成什么

用户当日反馈「现在的页面太丑了，感觉不如心里的预期」，经选项确认选定 **视觉方向 = 游戏化夜战 HUD**、**范围 = 整页重做**。
目标：把「深色 chrome + 浅色物理模型」的割裂感修掉，让整页读作一个夜间应急指挥沙盘；同时**不动**任何冻结契约、
验收 DOM id、诚实文案与语义色（灾情蓝 / 警戒琥珀 / 救援绿 / 封闭·断电红）。氛围只从环境来：夜色地面、亮窗、雨幕、信标脉冲、路径流光。

## 2. 在 Qoder 中做了什么

### 2.1 设计系统（`src/styles/console.css`）
- `:root` 与 `html[data-theme='daylight']` 各补一套 `--map-*` 沙盘材质 token（地面/底座/草坪/铺装/路缘/路面/立面/侧壁/屋顶/窗带/树/校门/路口/牌底/HUD），SVG scoped 样式全部引用 token，双主题一键翻转。
- 新增 `--font-display`（Bahnschrift / DIN Alternate / Arial Narrow，Windows 自带零依赖）用于时钟与大数字。
- 后置「夜战 HUD 重设计」覆盖节：细网格 body、顶栏渐变信号线、rail 模块顶部信号细线（回合琥珀/评分绿/动作红/信息流蓝）、4px 小圆角、HUD 深色玻璃牌 + blur、动作卡左缘信号条。
- 语义动效 keyframes：`beacon-pulse` / `rain-fall` / `glow-breathe`；全局 `prefers-reduced-motion` 规则覆盖 CSS 动画，SMIL 流光由组件 `matchMedia` 门控。

### 2.2 地图渲染（`src/components/CampusMap.vue`）
- **体量成立的根因修复**：原投影只压缩 y、抬升 z，无横向偏移 → 只看得见南立面，楼读作平板。新增 `KX = 0.38` 柜式斜投影（高度向右偏），`wallFaces` 可见性改为 `ny > 0 || nx < 0`，西侧面首次可见；侧壁用更暗的 `--map-facade-west` 形成体积对比。
- **窗带改离散窗格**：原来整条横向 ribbon 像条码；现按墙长每 ~11 单位切格、每格独立亮灭（`k % 10`：<3 暗 / <8 暖 / 其余冷），断电楼 `is-dark` 全窗灭。
- 屋顶：类别色改为 15% 罩染 + 中性 parapet 内圈 + 类别描边降为 1.2px / 0.6 透明（选中/悬停才提亮），去掉「霓虹描边平板」观感；类别识别仍与图例一致。
- 灯光：入口暖光池（`entrance-pool`，断电消失）、路口/校门路灯光池（`lamp-pool`）、入口凹龛改亮窗色。
- 地面对比：底座 `--map-ground` 提亮 + 边缘描边，舞台背景改径向微光 vignette，沙盘不再「浮在纯黑里」。
- 雨幕仅当快照存在 flood 路段；路径流光点沿 `RouteResult.points` 同一条 path 行进（不虚构轨迹）。

### 2.3 文案去内部编号（用户可读口径）
- `DrillView.vue` / `MapView.vue`：rail 头去掉 `R0…R8b` / `00…06` 编号与 `replayTo / getRoute / snapshot / legend` 等接口名；note 去掉 `FR-4.1 / VS-01 / VS-02 / JW-09 / TC-07` 等文档码，改_plain 中文_（例：「线索按时间分批出现，没到时间的看不到；出现一条就能判一条」）。
- HUD 微标签 `SIM CLOCK / NETWORK / ROAD STATUS` → 「模拟时钟 / 校园路网 / 道路状态」；MapView HUD 去掉 `viewBox` 调试行。
- `ObjectDetail.vue` 路段 note 去 `JW-09 / RE-07`；`App.vue` 页脚去 `D4/D2/D1～D3` 里程碑码与文件路径行。
- **保留**：全部验收 id、`回看只读。返回第 N 回合后可继续提交。`、fixture 前置原文、拒绝码原文、`示例回放 · 非临场` 子标题、三处诚实标注与 24 span 水印。DiagnosticView 作为诊断台保留接口名与用例码（其受众就是核对接口）。

### 2.4 自查修复
- **375px 舞台塌缩**：重设计覆盖节里 `.mapwrap` 双列规则写在媒体查询之外，覆盖了 ≤900px 单列规则 → 舞台宽 0。已包进 `@media (min-width: 901px)`；复测舞台 355×374。
- **daylight 对比度不足**：`--muted #5c6577` 使 ribbon 4.42 / 回合刻度 4.21 < 4.5 → 改 `#4f596b`，复测 5.33 / 5.04。
- **dev 模板缓存陈旧**：5173 旧进程（PID 3232）模块图不刷新，截图残留旧文案；kill 后重启 dev（与本会话早前记录一致的老问题）。

## 3. 如何验证（全部本会话实测）

截图方法：内置 Browser 面板隐藏（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），改用**本机 Edge headless + CDP**（Node 24 原生 WebSocket 驱动，临时 harness 在系统 Temp，不进仓库）：
`Page.captureScreenshot` 出图、`Runtime.evaluate` 做 DOM/对比度探针、`Input.dispatchKeyEvent` 做真实 Tab 焦点、`Log.entryAdded`/`Runtime.exceptionThrown` 收控制台错误。

### 3.1 闸门
- `npm run check:d4`（含 D1–D3 回归）全过：甲 80/100/80/70→**83**（响应 45s·seq1·违规 [14,20]）、乙 60/0/50/55→**44**（250s·seq16·[9,14,15]）、甲+A4 80/100/100/70→**90**（[14,21]）、早 A4→83 / 准时 A4→90、SC-08 46、JW/Sort/Scoring 全过。
- `npm run typecheck:app` 过；`npm run build` 过：`index-BQV3piiC.js 267.02 kB / gzip 83.61 kB`、`index-Dp5kXK5m.css 56.95 kB / gzip 11.27 kB`、`✓ built in 290ms`。

### 3.2 对比度（alpha 合成后，9 对 × 双主题）
| 选择器 | ops | daylight |
| --- | --- | --- |
| .ribbon-text | 6.59 | 5.33 |
| .rail-head h2 | 16.93 | 13.30 |
| .rail-sec .note | 7.63 | 6.04 |
| .statusbar-notice | 7.63 | 6.04 |
| .topnav .btn | 9.07 | 5.10 |
| .round-tick .tick-t | 7.24 | 5.04 |
| .map-stage .hud-clock | 10.93 | 12.23 |
| .label-name（SVG） | 16.00 | 12.38 |
| .mark text（SVG） | 9.07 | 6.61 |

最小 ops 6.59 / day 5.04，全 ≥4.5。

### 3.3 触控 / 焦点 / 控制台 / 完整性
- 触控：1440 与 375 下 `button, select, .chip, .round-tick, .bld-row, .road-pick, input[range]` 可见者最小边 **0 个 <44px**。
- 键盘：真实 Tab 后 `activeElement` 为顶栏按钮，焦点环 `2px solid rgb(255,178,36)` 可见。
- 控制台：整轮导航 + 交互 **0** 条 `CONSOLE-ERROR` / `PAGE-EXCEPTION`。
- 水印 24 span；推演徽标「预置剧本，实时判定与评分」（无「示例回放」）。
- 条件 id 说明：`finish-drill / score-breakdown / drill-location-score / drill-review / ledger-table / action-feedback` 为状态条件渲染；实测提交 A1 后 `action-feedback`+`ledger-table` 出现（反馈原文「A1 上报核查 → 萃园 7 幢（北 7） · 第1次 · 已通过 · 进行中 · 预计 @185」），末回合 `finish-drill` 出现，结算后 `score-breakdown / drill-location-score / drill-review` 齐备。
- 回看只读原文复测： furthest=第10回合 回跳第1回合 → 「回看只读。返回第 10 回合后可继续提交。」
- 临场评分诚实性：零操作结算 = **15**（甄别0/响应0/命中0/违规100，判读 0/10，未提交排序并给参考 U2→U8→U4），不套用基线；双分支对照牌仍显示 83/44/90 且注明「示例回放对照，非本轮临场计算」。

### 3.4 截图（assets/，本会话 CDP 实拍）
- `d4-night-ground-1440.png` 夜航总览（体量/亮窗/光池/底座）
- `d4-night-massing-1440.png` 斜投影侧壁 + 离散窗格首版
- `d4-night-rain-1440.png` T+140 雨幕 + 积水标记 + 火情范围圈
- `d4-night-route-1440.png` 路径亮线 + 端点（流光 SMIL 在动）
- `d4-night-settled-1440.png` 末回合结算面板（15 分诚实口径）
- `d4-night-score-1440.png` 结算后回看：双分支 83/44/90 + 回看只读 HUD
- `d4-night-readonly-1440.png` 回看只读文案态
- `d4-daylight-rain-1440.png` / `d4-daylight-overview-1440.png` 教室投影纸面模型
- `d4-night-375.png` 375px 单列 + 46dvh 舞台 + dock

## 4. 自我纠错 log（无效测量作废声明）
1. 首版对比度探针在 `#theme-toggle.click()` 后**同步**读数，Vue _watchEffect 未 flush_ → day 与 ops 完全相同，**作废**；加 150ms settle 后重跑（§3.2 为重跑值）。
2. 首版路径截图复用 CDP profile 残留 daylight 主题且误用 `#route-from`（推演页实为 `#drill-route-from`）→ 无路径线，**作废**；加主题复位步 + 正确 id 重拍。
3. 375 首拍舞台宽 0 系本人覆盖节媒体查询失误（§2.4），修复后重拍重测。
4. 旧 dev 进程缓存导致的「文案未生效」截图不作为验收依据；重启后所有截图取自新进程。

## 5. 待办 / 边界
- 本轮**未改**任何冻结文件（`contracts.ts / fixture-port.ts / fixtures/*.json / db/schema.sql / scripts/validate-*.ts`）；deps 仍仅 vue。
- 四路径 UI 全流程（83/90/44/83 逐控件回放）沿用同日早间两次独立签认；本轮逻辑零改动，仅以 check:d4 + 提交/结算/回看交互复测覆盖回归。
- 验收单 §8 第 63–65 项为重设计前数值；重设计后复测见 §3.2/§3.3，已在验收单新增 §10 注明取代关系。
- 对话截图（Qoder 会话侧）仍待补；git commit/push 待用户明确授权，未擅自提交。