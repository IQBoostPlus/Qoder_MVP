# D1 · 2026-11-17 · 双主题换肤：夜航指挥（默认）/ 教室投影·日光纸面

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F1 地图渲染 / F6 响应式 / F7 声明与水印（见 README 功能清单） |
| 状态 | 已完成 |

## 1. 想完成什么

用户看完指挥舱改版后追问：「等一下，你的意思是最终页面会是这种色调？」——深色不应是我单方面替用户定死的最终答案。本步骤把配色升级为**两套完整、可一键切换的主题**：默认 `ops` 夜航指挥（深色应急语义），新增 `daylight` 教室投影·日光纸面（训练沙盘要在教室投影上演示，深色底在投影仪上发灰、浅色纸面才读得清）。全部颜色收敛为 CSS token，`html[data-theme]` 换肤覆盖页面、HUD、情报轨、诊断台、滚动条与地图 SVG（含楼栋类别色），选择持久化到 localStorage；顶栏常驻切换按钮。最终色调由使用者看着实机决定，而不是由我口头承诺。

## 2. 在 Qoder 中做了什么

- 指令：用户原话「等一下，你的意思是最终页面会是这种色调？」，据此下达双主题 token 化规格；约束沿用（不改 A 冻结文件、不引新依赖、不另写空态文案、不 commit/push）。
- 生成/修改（均 B 轨自有文件）：
  - `src/styles/console.css`：`:root` 增加语义派生 token（grid/wash/edge/glow/halo/sheen/road-base/zone-ink/mark-*）与 8 组楼栋类别 token；新增 `html[data-theme='daylight']` 全量覆写（暖纸底 #f1ede2 / 冷墨字 #1a2436 / 深赭 amber #7a5400 / 压暗的 blue·red·green·violet / 纸面滚动条与边框）；全文硬编码 rgba/hex 替换为 token；`color-scheme` 随主题切换。
  - `src/config/categories.ts`：类别 color/fill 改为 `var(--cat-*)` 字符串（键仍为 category，D2 补 20 栋零改动）。
  - `src/components/CampusMap.vue`：楼栋 polygon 改 `:style` 绑定（SVG 属性不支持 var()）；舞台底 rect / 网格 pattern / sheen 渐变 stop 改 class 走 token；scoped 样式全部 token 化（标签描边 halo、路底、灾情/封闭标记填充、辉光）。
  - `src/App.vue`：`theme` ref + `watchEffect` 写 `document.documentElement.dataset.theme` 与 localStorage(`campus-drill-theme`)；顶栏新增 `#theme-toggle`（orb 渐变圆点 + 目标模式文案 + `aria-pressed`，44px 触控）。
- 实测发现并当场修复：daylight 初版 amber #9a6b00 在纸面对比度 **4.01**，小字号（徽章 11px / 舱号 11px / 风险标 9.5px）不达 AA 4.5 → 加深为 #7a5400，复测 **5.80（纸面）/ 5.05（amber-soft 徽章底）**；类别食堂色同步加深。
- 运维记录：会话间隔期间 dev server 已停（curl 拒连），以 `npm run dev` 后台重启后继续验证；浏览器标签曾为 about:blank，重新导航后实测。
- 对话截图：待补（见 §5）
- 生成结果截图：`assets/D1-theme-ops-desktop.png`、`assets/D1-theme-daylight-desktop-t165.png`、`assets/D1-theme-daylight-375.png`、`assets/D1-theme-daylight-375-t165.png`

## 3. 如何验证

浏览器实操（browser-use MCP；同源 iframe 按 1280/375 真实宽度触发媒体查询；localStorage 预置后新建 iframe 验证持久化首屏）。

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 切换链路 | 浏览器实操 | 点击 `#theme-toggle`：`data-theme` ops→daylight；body 背景 rgb(7,11,18)→rgb(241,237,226)、正文 rgb(233,238,247)→rgb(26,36,54)、时钟 rgb(255,178,36)→rgb(122,84,0)、路底 rgb(51,69,106)→rgb(183,174,156)、标签 halo rgba(7,11,18,.85)→rgba(247,243,233,.9)、舞台底 fill 同步；`aria-pressed` false→true；按钮文案显示目标模式 |
| 地图 SVG 换肤 | 浏览器实操 | 宿舍 polygon stroke rgb(167,139,250)→rgb(106,72,201)、fill rgba(167,139,250,.2)→rgba(106,72,201,.14)；图例 swatch 边框同步 rgb(106,72,201) |
| 持久化首屏 | iframe 实测 | 预置 localStorage 后新建 iframe：ops 预置→`theme=ops`；daylight 预置→`theme=daylight`（无需点击） |
| daylight 对比度 | 计算实测 | 纸面底：正文 **13.30**、muted **5.01**、blue **4.51**、red **4.81**、green **4.54**；amber 修复后 **5.80**（纸面）/ **5.05**（徽章 soft 底）；修复前 4.01 已记录为缺陷 |
| ops 1280×900 | iframe 实测 | svgH 686；`.seg` none；8 栋；`pageVScroll=false` |
| daylight 1280×900 | iframe 实测 | svgH 686；`pageVScroll=false`、`pageHScroll=false`；情报轨渐变 rgb(255,253,247)→rgb(247,243,233) |
| daylight 375×812 | iframe 实测 | svgH 352；minTouch **44**（含切换按钮 44）；ribbon 12px；`pageVScroll=false`、`pageHScroll=false`；道路 tab 仅显示 sec-roads |
| daylight 双状态 t=165 | 浏览器实操 | R-N7E「积水 @140 / 已封闭 @165 · seq17」；标记 hazard=1 closed=1（桌面与 375 各一次） |
| daylight 评分/空态 | 浏览器实操 | 原始示例 `#score-live` 83（80/100/80/70）；t=165 偏离→`#score-pending` 常量；`#route-pending` 常量 |
| daylight 声明 | 浏览器实操 | 首屏与页脚均 91 字逐字常量，同屏可见 |
| daylight 诊断页 | 浏览器实操 | `.diag-scroll` 内滚可到底（scrollTop+clientH==scrollH）；面板纸面渐变；表头 muted rgb(92,101,119)；页面零滚动 |
| 控制台 | 控制台 | 仅 vite HMR debug，无 error / warning |
| 类型与构建 | CLI | `vue-tsc` 通过；`vite build`：`index-B5Z05Fx2.css 24.59 kB` / `index-D-mtRKCb.js 143.05 kB` |
| 冻结基线 | CLI | `npm run check:d1-v2` **EXIT=0**（83/44/90、hardcode scan clean） |

- 验证截图：见 §2 清单（1280 两图为等比缩放取景，媒体查询按 iframe 自身宽度生效；375 为原尺寸）。

```
$ npm run build && npm run check:d1-v2   （节选尾部，完整基线输出见 D1-2026-11-17-console-redesign.md）
dist/assets/index-B5Z05Fx2.css   24.59 kB │ gzip:  5.69 kB
dist/assets/index-D-mtRKCb.js   143.05 kB │ gzip: 47.18 kB
✓ built in 231ms
visibility: t=80 U1/U3/U2/U4/U5; t=300=10; U1 30=待核, 90=真报
replay: jia seq20 5 accepted/4 rejected/5 occupancy; R-N7E flood at 140, closed at 165
rejections: jia [14,20]; yi [9,14,15]
score: jia 83; mutation=>null; 1x/4x response=45s
route: null (pending); hardcode scan clean; README precision notice matched
EXIT=0
```

## 4. 结论与后续

- 达成：两套主题均为完整成品（非半成品换色），页面/地图/诊断台/滚动条/徽标/空态全链路换肤；默认 ops、可一键切 daylight、选择持久化；三档视口零页面滚动保持；冻结基线 exit 0。
- 缺陷闭环：daylight 小字 amber 对比度 4.01→5.80/5.05，已复测关闭。
- 最终色调决策权交还用户：实机顶栏按钮即切换器；作品帖/答辩可按场景选用（夜航=应急指挥语义，日光=教室投影与打印）。
- 边界不变：仍为 fixture 静态回放；点选 D2、实时评分 D4；未 commit/push。

## 5. 待补凭证

- [ ] 用户补拍：「最终页面会是这种色调？」追问与双主题交付的 Qoder 对话截图（`assets/D1-theme-chat-01.png`）
- [ ] 用户补拍：实机切换两主题后的确认截图（`assets/D1-theme-chat-02.png`）