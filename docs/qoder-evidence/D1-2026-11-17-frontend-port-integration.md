# D1 · 2026-11-17 · 前端骨架 + 接入 A 只读接口 + 浏览器侧验证

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | F1 地图元数据、F4/F5 可见性与回放、F8 评分接口边界、FR-3.3 / FR-8.3 训练标识 |
| 状态 | 已完成（静态接入）；D2 点选 / D4 实时评分待后续 |

## 1. 想完成什么

建立可在浏览器运行的前端骨架，接入 A 已交付的 `createFixturePort`（`src/fixture-port.ts`），用最小诊断页证明只读接口在**真实浏览器**里工作，并答复 A 在 [`D1-2026-11-17-engine-port.md`](D1-2026-11-17-engine-port.md) §5 提出的 5 项跨轨确认。对应 T2；不做 SVG 地图渲染 / 响应式栅格 / 页脚精度声明（T3）。

**边界重申**：B 只消费 A 导出的接口与状态，不另写地图派生、可见性、判断窗、回放推导、违规统计、寻路或判分。83 / 44 / 90 是契约值，不是可调参数。

## 2. 在 Qoder 中做了什么

- 逐字读 [`docs/handoff-d1.md`](../handoff-d1.md) §0 接口约定与 §2 接口表、[`src/fixture-port.ts`](../../src/fixture-port.ts) 全 580 行、[`src/contracts.ts`](../../src/contracts.ts)、A 的引擎凭证 §5、需求 §2/§4/§5/§7、质量验证 CD/JW/TC、`tsconfig.json` / `package.json`、云端凭证。
- 复跑 `npm run check:d1-v2` 确认基线（83/44/90 不变）后才动前端。
- 技术选型 **Vite + Vue 3 + TypeScript**（理由见 §4）。新增依赖仅构建工具与框架：`vue@^3.5.45`（runtime）、`vite@^8.3.8`、`@vitejs/plugin-vue@^6.0.11`、`vue-tsc@^3.3.14`（dev）。**未引入** UI 组件库 / 状态管理库 / 地图库 / 测试框架。
- 新建 `index.html`、`vite.config.ts`、`src/main.ts`、`src/App.vue`、`src/styles/console.css`、`src/env.d.ts`、`tsconfig.app.json`（继承基线、仅扩 include 覆盖 `.vue` 与 `vite.config.ts`，**基线编译选项未动**）。
- 新建 [`src/composables/useFixturePort.ts`](../../src/composables/useFixturePort.ts)：模块级单例持有 `createFixturePort(fixture)`，组件不重复构造；唯一数据源 `fixtures/canonical-run.json`（不读 `buildings.json`，避免双源分叉）。JSON 推断会把字面量联合拓宽为 string，按 A 校验器同款口径 `as unknown as CanonicalFixture` 断言（非 `!` 蒙混）。
- 新建 [`src/views/DiagnosticView.vue`](../../src/views/DiagnosticView.vue)：7 个面板（地图派生 / 可见性与判断窗 / 只读回放 / 静态评分对照 / 路径空态 / 错误演示 / 倍速对照），全部文本与表格，不画地图。
- `package.json` 增加 `dev` / `build` / `preview` / `typecheck:app`，保留 `check:d1` / `check:d1-v2` 原样。
- 浏览器实操（Vite dev server + 真实浏览器）逐项跑 §8 并截图（见 §3）。
- 过程中修正两处**界面侧**问题（不改 A 基线）：① 回放截断原先恒传 `seq`，无法表达「仅 t_sim」截断，补 `seq 上界` 开关；② 倍速播放原用链式 `sleep`，后台标签定时器节流会失真，改为单循环 + 绝对时间戳按 `elapsed*speed` 推导步数。
- 未改 `contracts.ts` / `fixture-port.ts` / `fixtures/*.json` / `schema.sql` / `validate-*.ts`；未放宽 `strict` / `noUncheckedIndexedAccess`；未 commit / push；未改全局 git 配置。

- 对话截图：待用户补拍（见 §5）
- 生成结果截图：`assets/D1-frontend-port-01-overview.png`、`assets/D1-frontend-port-11-final-overview.png`

## 3. 如何验证

### 3.1 基线 / 类型 / 构建（CLI，完整输出）

```
$ npm run typecheck && npm run typecheck:app && npm run build
> tsc --noEmit            （通过，覆盖新增 .ts）
> vue-tsc --noEmit -p tsconfig.app.json   （通过，覆盖 .vue）
> vite build
dist/index.html                   0.52 kB │ gzip:  0.37 kB
dist/assets/index-2tIHyx-C.css   10.52 kB │ gzip:  2.82 kB
dist/assets/index-f6TFL01J.js   125.70 kB │ gzip: 41.80 kB
✓ built in 109ms

$ npm run check:d1-v2
D1 canonical fixture validation PASSED
buildings=8 junctions=1 roads=8 reports=10 actions=6 runs=3
run-jia-1x [甲] 80/100/80/70 = 83 | 响应 45s
run-yi-1x [乙] 60/0/50/55 = 44 | 响应 250s
run-jia-plus-a4 [甲补做A4] 80/100/100/70 = 90 | 响应 45s
clock_checks: 1× = 45s, 4× = 45s
D1-v2 fixture port validation PASSED
```

完整输出另存 [`d1-v2-local-validation.log`](d1-v2-local-validation.log)（A 基线）。本轮复跑 exit 0，83/44/90 不变。

### 3.2 浏览器逐项实测（§8 1–16）

| # | 验收项 | 方式 | 实测结果 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | `check:d1-v2` 全过 83/44/90 | CLI | 通过，exit 0 | §3.1 |
| 2 | typecheck + 前端类型过、无 `!` | CLI + grep | `tsc`/`vue-tsc` 均过；grep `\w!\.`/`as any`/`@ts-ignore` 无命中 | §3.1 |
| 3 | build 产出静态文件 | CLI | dist 三文件产出 | §3.1 |
| 4 | view_box_svg / GATE3 / 8 长度>0 | 浏览器 DOM | `40 40 880 560`；GATE3=(500,520)；8 条长度 120/40/40/40/70/80/457.82/60 均>0 | 04 |
| 5 | t=80 恰 U1/U3/U2/U4/U5 无 U6；t=300=10 | 浏览器 | t80 ids=`U1/U3/U2/U4/U5`；t300 count=10 | 02、03 |
| 6 | U1 t30/89 待核、t90/100 真报 | 浏览器探针 | t30 待核[30,90)、t89 待核、t90 真报[90,∞)、t100 真报 | 02 |
| 7 | 甲 seq20：5/4/5；U1 supersedes→2 | 浏览器 | counts=`5 / 4 / 5`；U1 seq7→supersedes 2 | 05 |
| 8 | t140 积水未闭 / t164 未闭 / t165 闭 seq17 | 浏览器（仅 t 截断） | t140 积水+未封闭；t164 未封闭；t165 已封闭 closed_at=165 by=17 | 06、07 |
| 9 | 违规读 details：甲[14,20] 乙[9,14,15] | 浏览器 | 甲 `[14, 20]`；切乙 `[9, 14, 15]`，不自行统计 | 05、08 |
| 10 | getScore 甲 83；改动后 null+常量 | 浏览器 | 基线 83；删减末条 → `null → 实时评分待引擎接入` | 08 |
| 11 | getRoute null+ROUTE_PENDING_TEXT | 浏览器 | `null → 路径计算待引擎接入` | 09 |
| 12 | 非法截断显示 code+object_id | 浏览器 | seq=-1 → `REPLAY_INVALID_CUT`/`seq`；t=-5 → `REPLAY_INVALID_CUT`/`t_sim` | 09 |
| 13 | 示例回放 + 训练模拟数据 常驻 | 浏览器 | 顶栏 sticky 两徽标常驻；逐条上报带训练徽标 | 04 |
| 14 | 1×/4× t_sim 序列与响应 45 相同 | 浏览器播放 | 两轨 11 步序列完全一致；1× 真实 5015ms / 4× 1301ms；响应 45 模拟秒 | 10 |
| 15 | 控制台无 error / 未处理 rejection | 控制台 | 仅 vite connecting/connected debug，无 error | — |
| 16 | 无硬编码楼栋 id/名称/坐标/viewBox | grep | 实现仅命中播放步长常量 500（非坐标）；契约注释属 A 文件 | — |

截图目录 `assets/`：01-overview、02-vis-t80、03-vis-t300、04-map-badges、05-replay-seq20、06-roads-t140、07-roads-t165、08-score-yi、09-route-error、10-speed、11-final-overview。

**重要边界**：T2 是**静态接入**。fixture 仅三条预录流水，`getScore` 只认完整基线、`getRoute` 恒 null。**未验证 D4 实时评分**（甲+合法 A4@150→90 / 甲+非法 A4@100→仍 83 的一正一反做不到），该判据待 A 引擎。页面已把「示例回放」与「训练模拟数据」常驻标注，不把静态对照当临场评分。

## 4. 结论与后续

- **结论**：前端骨架 + 只读接口接入完成，16 项浏览器/CLI 验收全部实测通过，基线未破坏。B 不再维护第二份推导逻辑。
- **选型理由**：Vite 与现有 `moduleResolution:"Bundler"` / `resolveJsonModule` / `lib:["ES2022","DOM"]` 天然兼容；Vue SFC 对 D3/D4 时间轴与动作面板状态管理省力；本机已装 `@vue/cli`。`tsconfig.app.json` 继承基线仅扩 include，未放宽任何编译选项。
- **新增依赖**：vue ^3.5.45；dev：vite ^8.3.8、@vitejs/plugin-vue ^6.0.11、vue-tsc ^3.3.14。无 UI/状态/地图/测试库。
- **后续**：T3 做 SVG 地图 + 响应式栅格 + 首屏/页脚精度声明；D2 点选与路径、D4 实时评分待 A。

### 4.1 答复 A 的五项跨轨确认（§7 逐项）

| # | B 的答复 |
| --- | --- |
| 5.1 | 界面只读 **JSON 解析后的类型**（`CanonicalFixture`），不碰 DB 扁平列；同意 `details` 为复盘明细唯一来源（违规只读 `details.violation_event_seqs`）；导出保留 `score_json` 原样。同意 A 主笔改需求文档。 |
| 5.2 | 路径线画在**同一 SVG 的独立 `<g>` 图层**；`unreachable` 用 `ROUTE_UNREACHABLE_TEXT` + 灰色虚线，与 `null` 的「待接入」区分；**需要 `road_ids`** 以便封路高亮。 |
| 5.3 | 地图页脚固定底部、字号 ≥12px、对比度 WCAG AA；导出 JSON 携带 `precision_notice` 字段（用同一 `PRECISION_NOTICE` 常量）；T3 截图同时含页脚与训练水印。同意 CD-05 验收对象是可见页面与 README。 |
| 5.4 | 采纳**方案 1**（只影响图上路径长度，不改动作耗时）。路径旁显示 `length_px` 换算的图上长度；动作面板只显示 `duration_sim`（模拟耗时），不显示「增援耗时」；若日后显示须区分「图上长度」与「模拟耗时」。`duration_sim` 恒为目录常量，绝不因距离推导。 |
| 5.5 | 只需 GATE3 显示名与坐标，`port.map.junction_positions` 已够；**不需要**按路口反查路段，D2 可继续不建第九表。 |

## 5. 待补凭证

- [ ] 用户补拍本轮 Qoder 对话截图（骨架搭建、接口接入、浏览器验证与两处界面修正过程）。