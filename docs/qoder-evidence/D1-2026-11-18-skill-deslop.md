# D1 · 2026-11-18 · 安装 anti-slop skill 并做界面去 AI 味精修

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F2 地图与态势呈现 / F6 响应式与可读性（指挥舱视觉系统） |
| 状态 | 已完成（双主题 + 1280/375/320 实测通过；基线 exit 0） |

## 1. 想完成什么

用户指令：「调用一下 codex 的 @find skill 给你安装一下，美化前端页面，降低 ai 味儿的 skill。」

拆成两件事，都要落地：

1. 用 `find-skills` 走 skills.sh 生态，**真的安装**一个「美化前端 / 去 AI 生成感」的 skill，并交代来源与可信度；
2. 用该 skill 的规则对现有指挥舱做一轮**精修**（不是重做布局、不是换掉用户已选的双主题），消除模板感与 AI 味，同时顺手补上手机端真正读不到数据的可读性缺口。

硬约束不变：不改 A 冻结基线（`src/contracts.ts`、`src/fixture-port.ts`、`fixtures/*.json`、`db/schema.sql`、`scripts/validate-*.ts`），不放宽 strict / `noUncheckedIndexedAccess`，不新增运行时依赖，空态与声明文案仍 import 导出常量，`npm run check:d1-v2` 必须仍全过，不 commit / push。

## 2. 在 Qoder 中做了什么

### 2.1 发现与安装（find-skills → skills CLI）

- 调用 `find-skills` skill，按其流程先看 skills.sh 榜单再 `npx skills find`，候选集中在「anti-AI-slop / distinctive frontend design」方向。
- 选定 **`design-taste-frontend`（tasteskill 2.5.1）**，来源 `leonxlnx/taste-skill`。安装命令与结果：

```
$ npx -y skills add leonxlnx/taste-skill@design-taste-frontend -g -y
Installed design-taste-frontend -> C:\Users\ljh\.agents\skills\design-taste-frontend
（CLI 同时向 Qoder / Qoder CN 的 skills 目录建立符号链接，本会话已可见该 skill）
```

- 可信度核对（安装前实测读取，非推测）：
  - skills.sh 安装量 **792.9K**（同仓 `redesign-existing-projects` 为 458.8K）；
  - GitHub 仓库 **117,867 stars / 7,885 forks**，created 2026-02-19，pushed 2026-11-08；
  - CLI 安全面板：Gen 评级 `Critical Risk`、Socket **0 alerts**、Snyk `Med Risk`（启发式评级）。**安装后先通读 SKILL.md 与 references 再使用**：内容为 markdown 规则 + 可选 node 脚本，安装动作本身只克隆仓库，不执行仓库代码。
- 配套 skill **安装失败，未安装**（如实记录）：

```
$ npx -y skills add leonxlnx/taste-skill@redesign-existing-projects -g -y
EXIT=1  Failed to clone repository ... Temp\skills-Z2IYB0
```

  主 skill 已覆盖本次所需规则，未重试第二次克隆。

### 2.2 skill 的适用边界（哪些用了、哪些故意没用）

tasteskill 面向**营销站**（hero / 分屏 section / 真实照片 / 调色发牌 / gate 门禁）。本项目是**工具型 WebApp（应急推演指挥舱）**，且用户已明确选定双主题配色。因此只取与 WebApp 相关的规则，**不跑**它的发牌与门禁脚本：

| skill 脚本 | 是否运行 | 原因 |
| --- | --- | --- |
| `gate.mjs` / `consistency.mjs` | 否 | 强制营销站结构（`data-type` / `site-kind` meta、一屏一 section、hero 入场、dealt moment），工具型控制台没有这些 section，跑只会判失败或诱导改结构 |
| `start.mjs deal` / `deal.mjs` / `start.mjs css` | 否 | 会**重新发牌配色**覆盖用户已选定的夜航 / 日光双主题；skill 自身规定客户自有颜色走 `brand` 通道、不调色 |
| `copy-lint.mjs` | 否 | 面向营销文案（h1 卖点、动词按钮、每屏 60–80 词）；本项目文案是契约常量与训练级声明，**逐字不可改** |
| `perf.mjs` | 否 | 以营销站资产（照片 / shader / WebGL）为权重模型；本项目无这些资产，改用浏览器实测 + 构建产物体积 |
| `photos.mjs` / `icons.mjs` / `moments.mjs` / `scenes.mjs` | 否 | 需要真实照片 / 品牌图标 / 创意场景；应急沙盘用自绘 SVG 地图与数据表，引入照片反而失真 |

**实际采纳并落地的规则**：单一圆角尺度、单一卡片样式（去渐变）、hover 抬升 + press 下压、去掉交错淡入、全局 reduced-motion 兜底、文本与控件对比度、44px 触达、320px 不溢出不碰撞、**禁紫 / 禁薰衣草**、客户自有配色不受发牌约束、数字等宽。

### 2.3 代码改动（全部 B 侧）

- `src/styles/console.css`
  - **去紫**：删除 `--violet` / `--violet-soft` / `--edge-violet`（双主题）与 `.badge-violet`；宿舍色改 `#8bd450`（ops）/ `#4d7c0f`（daylight），行政楼从periwinkle 紫蓝改**亮度极**`#dfe7f3`（ops）/ `#33405a`（daylight），8 类色相可分辨。
  - **单一圆角尺度**：新增 `--r-sm:4px / --r-md:8px / --r-lg:12px`，全站圆角归并到这三档。
  - **单一卡片样式**：`.panel` / `.rail-sec` 改纯色 `var(--ink-900)`，去掉面板渐变；辉光只保留在时钟 / 灾情 / 校门 / 滑块 / 被指对象。
  - **交互反馈**：`.chip` / `.btn` / `.bld-row` 统一 hover `translateY(-1px)` + active `translateY(1px)`，`.btn:disabled` 不位移；去掉按钮辉光。
  - **动效克制**：删除 `@keyframes rise-in` 与 `.rail-sec` 交错延迟；reduced-motion 改全局 `*,*::before,*::after` 兜底。
  - **数字等宽**：badge / score-total / `.m-v` / `td.num` / slider-value / hud-clock / `.bld-count` / `.bld-meta` 上 `tabular-nums`。
  - **新增楼栋清单样式** `.bld-index / .bld-row（44px 起）/ .bld-name / .bld-sub / .bld-meta`、表格行高亮 `tr.row-hl` 与 `tr:focus-visible`。
  - **320px 真实缺陷修复**：≤900 单列改 `minmax(0,1fr)`、`.rail{min-width:0}`、`select/number{min-width:0;max-width:100%}`、svg `min-width:0`；新增 `@media (max-width:400px)` 表格密度档。
- `src/views/MapView.vue`：新增 `hovered` / `pinnedId` / `highlight` computed 与 `togglePin()`；图例区插入**楼栋清单**（8 行按钮：类别色块 + 名称 + 类别·分区·风险 + 层数·≈容量），hover/focus 与道路表格行双向联动地图高亮，点按钉住。
- `src/components/CampusMap.vue`：新增 `highlight` prop 与 `isRoadHl/isBuildingHl`，被指楼栋描边 2→4px + 琥珀 drop-shadow、被指路段 base 11px；去掉楼栋默认投影。
- `src/components/RoutePanel.vue` / `ScorePanel.vue`：空态字符号 ◇/⊘ 换**内联绘制 SVG**（`es-icon`），文案仍为导出常量逐字。
- `src/components/MapLegend.vue`：色块圆角归并 `--r-sm`。

未新增任何依赖（运行时仍仅 `vue`）；未改 A 冻结文件（`git status` 中这些文件无修改）；未 commit / push。

- 对话截图：待用户补拍（见 §5）
- 生成结果截图：`assets/D1-deslop-ops-desktop-t165.png`、`assets/D1-deslop-daylight-desktop-t165.png`

## 3. 如何验证

全部为浏览器实操实测（browser-use MCP，同源注入 `#rtest` iframe 真实触发媒体查询；桌面 1280×900 缩放取景，375/320 原尺寸），数值为读取到的计算值，非估计。

### 3.1 桌面 1280×900 · 夜航（ops）

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 整屏零页面滚动 | `scrollWidth/Height - innerWidth/Height` | X=0，Y=0；body `overflow:hidden` |
| 舞台与右轨 | 计算尺寸 | svgH 686 / stageH 708；rail 视口 708 → 内容 2215（**内部滚动**） |
| 渲染完整性 | DOM 计数 | 楼栋 8 / 路段 8 / 校门路口 1 / 清单行 8 |
| 声明逐字 | 文本长度 | 首屏 91 字 / 页脚 91 字，均等于 `PRECISION_NOTICE` |
| 评分（甲全样例 t=300） | 面板读数 | `83`，甄别 80 / 响应 100 / 命中 80 / 违规 70，违规 seq `[14,20]` |
| 路径空态 | 面板文本 | `路径计算待引擎接入`（导出常量） |
| 触达尺寸 | 30 个控件最小高 | 44px |
| HUD 不遮挡 | 包围盒 | 168 vs 663，无重叠 |
| 去紫 | 全节点扫描 | violet 节点 0（双主题） |
| 圆角尺度 | 全节点计算值集合 | {4px, 8px, 12px} |

### 3.2 双状态时间轴 / 评分偏离 / 回放（交互路径）

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| t=140 | 拖滑块 | hazard 1 / closed 0，`积水 @140未封闭` |
| t=164 | 拖滑块 | hazard 1 / closed 0（仍自然灾情态） |
| t=165 | 拖滑块 | closed 1 **且** hazard 1，`已封闭 @165 · seq17`（双状态叠加） |
| t=100（偏离样例） | 拖滑块 | `实时评分待引擎接入`，**未**回退基线分 |
| t=300 回正 | 拖滑块 | 83 |
| 切换乙 run | select | 44（乙自身全样例，合法） |
| 重置样例 | 按钮 | run-jia-1x · T+300s · 83 |
| 运行时错误 | `error` + `unhandledrejection` 监听下遍历 dock/主题/滑块/run/重置/钉住 | `[]` |
| 控制台 | `list_console_messages` | 61 条全为 `[debug] vite HMR`，**0 warn / 0 error** |

### 3.3 联动高亮与钉住（新增交互）

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 清单 hover → 地图 | 计算样式 | 被指楼栋 stroke-width 4px（其余 2px），drop-shadow 仅在被指对象 |
| 道路行 hover/focus → 地图 | 计算样式 | 被指路段 `.road-base` 11px |
| 钉住往返 | 8 栋逐一点按 | 8/8 正确 pin/unpin |
| 受控复测 | click1 pin → click2 unpin → 切 dock 失焦清除 → click3 pin → click4 unpin | 每步状态精确（合成 `.click()` 不移动焦点，已排除误判） |
| 主题切换后钉住 | 375 实操 | 钉住状态保留 |

### 3.4 对比度（rgba 先与父卡片底色合成再算，避免半透明误判）

| 元素 | ops | daylight | 判定 |
| --- | --- | --- | --- |
| 清单名称 | 16.93 | 13.30 | 文本 ≥4.5 通过 |
| 清单副行 / 容量 | 7.63 | 5.01 | 通过 |
| 钉住行名称 | 13.04 | 12.18 | 通过 |
| 钉住行副行 / 容量 | 5.88 | 4.59 | 通过 |
| 风险标注 | 8.42 | 5.31 | 通过 |
| 清单说明 | 7.24 | 5.29 | 通过 |
| HUD 时钟 | 10.93 | 5.80 | 通过 |
| 类别色块（8 类） | 最小 6.54 | 4.51 / 5.05 / 4.76 / 4.85 / 4.79 / 4.57 / 9.37 / 5.29 | 图形 ≥3 通过 |
| 地图描边 | 最小 10.38 | 4.27 / 4.78 / 4.33 / 4.54 | 图形 ≥3 通过 |

### 3.5 移动端 375 / 320（双主题）

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 375 滚动归属 | 计算尺寸 | main 视口 506 → 内容 921（内部滚动），页面滚动 0 |
| 375 舞台 | 计算尺寸 | stage 374 / svg 352（不塌缩） |
| 375 dock 过滤 | 逐 tab 切换 | 仅对应 `.rail-sec` 显示；清单行右缘 340 < 375 |
| 320 溢出（修复前） | 越界节点扫描 | **14 个越界**（单列 `1fr` 取 min-content 326px，舞台/右轨/第 4 个 tab 被裁）——真实缺陷 |
| 320 溢出（修复后） | 双主题 × 4 dock | 越界 0 / 碰撞 0；rail 与 stage 292，seg 右缘 300 |
| 320 道路表（修复前） | 表内横向滚动 | 21 个裁切单元格——真实缺陷 |
| 320 道路表（修复后） | ≤400 密度档 | tableW 260 / scrollW 258，无内横滚，裁切 0（375 亦 0） |
| 320 触达 / tab / 声明 | 计算值 | minTouch 44；segW 68；声明 91/91；页面滚动 0 |
| 清单可读性 | 截图目视 | 320 索引顶 255、6 行在视口；375 索引顶 236、8 行在视口；名称 13px、`5 层 · ≈500` 可读 |

### 3.6 构建与基线（CSS 末轮改动后**复跑**）

```
$ npm run build
BUILD_EXIT=0
vue-tsc --noEmit -p tsconfig.app.json && vite build
✓ 35 modules transformed.
dist/index.html                   0.52 kB │ gzip:  0.37 kB
dist/assets/index-DPSzff58.css   26.90 kB │ gzip:  5.99 kB
dist/assets/index-CrkPHs4g.js   145.47 kB │ gzip: 47.97 kB
✓ built in 204ms

$ npm run check:d1-v2
CHECK_EXIT=0
score: 83；改动/删减/新增/重排/未知 run 均 null；1×/4× 模拟时刻一致且响应 45s
run-yi-1x [乙] ... 总分=44 | run-jia-plus-a4 [甲补做A4] ... 总分=90
replay: R-N7E flood at 140, closed at 165 | rejections: jia [14,20]; yi [9,14,15]
map: GATE3=(500,520)；viewBox=40 40 880 560；8 条路段长度>0
D1-v2 fixture port validation PASSED
```

83 / 44 / 90 契约分未被触碰；A 冻结文件 `git status` 无修改。

### 3.7 截图清单（assets/）

| 文件 | 内容 |
| --- | --- |
| `D1-deslop-ops-desktop-t165.png` | 夜航桌面 1280×900，t=165 双状态叠加 |
| `D1-deslop-daylight-desktop-t165.png` | 日光桌面同状态 |
| `D1-deslop-ops-375-legend.png` | 375 夜航，楼栋清单在视口、钉住行高亮 |
| `D1-deslop-daylight-375-legend.png` | 375 日光，同视图 |
| `D1-deslop-ops-320-legend.png` | 320 夜航，清单 6 行可读、无横向裁切 |
| `D1-deslop-ops-320-roads.png` | 320 夜航道路表，密度档后无内横滚 |

## 4. 结论与后续

- 达成：skill 已真实安装并交代来源 / 安装量 / 安全面板；精修落地且**双主题 + 三档视口实测通过**，顺手修掉两个真实的 320px 裁切缺陷；基线与构建 exit 0。
- 真实可用性收益：手机端地图文字偏小是设计取舍，**楼栋清单成为可读口径**（层数 / ≈容量 / 风险），并提供触屏与键盘可用的图上定位（钉住），道路行 hover/focus 同步高亮。
- 明确不做：未跑 skill 的营销站门禁与发牌脚本（理由见 §2.2），因此**不声称**通过 tasteskill gate；配色最终决定权仍在用户（双主题切换保留）。
- 后续：D2 点选交互直接复用本次 `highlight` / `pinnedId` 通道；`redesign-existing-projects` 若后续需要可重试克隆（本次失败已记录）。

## 5. 待补凭证

- [ ] 用户补拍：本条指令「调用一下 codex 的 @find skill …降低 ai 味儿的 skill」的 Qoder 对话截图
- [ ] 用户补拍：skills CLI 安装输出与安全面板的界面截图（助手侧仅留文本输出）
- [ ] 用户补拍：精修后双主题桌面对比确认的对话截图