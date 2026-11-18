# D3+ · 2026-11-18 · 地图 2.5D 体量精致化 + 可操控性升级（B 侧渲染层）

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联 | 用户反馈「页面可操控性差、地图异常粗糙」；Q3 375px、T5 双主题 AA + 键盘、Q7/Q10 徽标、CD-04 零改动、CD-06 高度不对外当实测 |
| 状态 | 已完成（B 侧渲染/交互实测）；**不改 A 冻结数据**（footprint 仍为 fixture polygon）；真实非矩形 footprint 与 20 栋选点仍待 A |

## 1. 想完成什么

用户指出当前地图「异常粗糙」、页面「可操控性很差」。核实后拆成两层：几何是 A 手绘矩形（fixture 冻结，B 不改坐标）；渲染层只是纯色块 + 细虚线，且无缩放/平移/hover 反馈/图上圖例。本次在**不碰 A 数据、不引入 3D、不新增依赖**的前提下，把渲染层升级为 2.5D 体量 + 场所感背景 + 完整视图交互，解决「粗糙」与「可操控性」。

视觉方向经用户选定为 **2.5D 体量建筑**（备选：精致扁平 / 只修交互）。2.5D 高度**仅由层数做视觉比例**（requirements §6 明确允许），不对外展示为实测高度（CD-06）。

## 2. 在 Qoder 中做了什么

- 对话截图：待用户补拍（§5）。
- 重写 [`src/components/CampusMap.vue`](../../src/components/CampusMap.vue)（渲染层，唯一改动文件）：
  - **2.5D 体量**：每栋 footprint 派生 阴影（偏移深色）+ 地面轮廓 + 可见侧壁（外法线 y>0 的面，类别色 + 半透明深色叠加派生暗面）+ 屋顶（类别 fill + 顶部高光 + 内缩屋顶线）。高度 `massHeight(floors)=10+min(floors,8)*4`，仅视觉比例。几何仍 100% 来自 `map.buildings[].polygon`，无硬编码坐标。
  - **道路升级**：路肩（road-base 11px）+ 路面（ink-800 7px）+ 中心虚线（road-open 1.6px）；保留 hazard/closed 双态与命中区 22px。
  - **背景场所感**：分区淡色底晕（zone 聚合椭圆 + 高斯模糊）替代纯网格观感；分区水印字号 44→20（装饰性，`aria-hidden`）。
  - **视图交互**：滚轮缩放（以光标为中心）、拖拽平移、双击复位、＋/－/⤾ 按钮（44×44）+ 倍率读数；viewBox 由 `map.view_box` 初始化、仅运行时改变，默认值不变。
  - **hover/焦点信息卡**：pointerenter/focus 显示名称/类别/层数/容量/风险/灾情/警戒/救援（或路段双态、路口语义）；缩放/复位/拖拽开始时清除避免过期定位。
  - **选中强化**：屋顶描边加粗 + 外发光 + 「选中」角标（文字双通道保留）。
  - **图上迷你图例**：present categories（由数据派生）+ 通行/灾情/封闭，颜色 + 文字双通道；左下不越界。
  - **指北针 + 示意比例尺**：右中，文案「示意比例 · 非实测」，不暗示真实距离。
- **两个真实缺陷自查修复**：
  1. HUD 撞角：缩放控件/指北针初版放左上/右上，与视图原有 HUD（SIM CLOCK / NETWORK / ROAD STATUS）重叠 → 移至左中/右中空位。
  2. **指针捕获回归**：`pointerdown` 立即 `setPointerCapture(svg)` 会把后续 click 重定向到 svg，导致真实鼠标点选楼栋失效（合成事件直接 dispatch click 掩盖了它）→ 改为「拖拽超过 4px 阈值才捕获」，普通点击不捕获；`pointerup` 仅在有捕获时释放。

## 3. 如何验证

### 3.1 闸门（完整命令与输出摘要）

```
$ npm run typecheck:app   → EXIT=0（strict + noUncheckedIndexedAccess 未放宽；无 as any / ts-ignore / ! 断言）
$ npm run build           → ✓ 47 modules，dist 生成（CSS 42.39 kB / JS 217.92 kB）
$ npm run check:d1-v2     → PASSED：score jia 83；违规 甲[14,20]/乙[9,14,15]；R-N7E flood@140 closed@165；
                            1×/4× response 45s；route 静态 null；硬编码/固定 viewBox 扫描通过；README 精度一致；
                            map viewBox=40 40 880 560（默认未变）
```

A 冻结文件零改动；MapView / DrillView / DiagnosticView 逻辑未改（仅 CampusMap 渲染层）。

### 3.2 浏览器实测（Chrome via Qoder Browser Connector，dev http://127.0.0.1:5174/）

| # | 项 | 结果 | 实测值 |
| --- | --- | --- | --- |
| 1 | 控制台 0 error / 0 warn | ✅ | list_console_messages(error,warn) = 空 |
| 2 | 2.5D 体量渲染 | ✅ | 8 栋各 1 屋顶 + 1 可见侧壁 + 阴影；截图 d3-polish-25d-ops.png / before-flat.png 对比 |
| 3 | 真实点击路径点选（pointerdown→up→click 无移动） | ✅ | is-selected=true、aria-pressed=true、sel-tag 存在、ObjectDetail 联动显示对象名 |
| 4 | 点选切换语义（同对象再点取消） | ✅ | toggleSelect 二次点击取消（测试中曾误判为 bug，实为切换语义） |
| 5 | 拖拽平移 | ✅ | viewBox 40 40 880 560 → -78.9 -2.6 880 560 |
| 6 | 拖拽不误清选中 | ✅ | 拖拽后 is-selected 仍 true（movedRecently 守卫 click） |
| 7 | 双击 / ⤾ 复位 | ✅ | viewBox 回到 40 40 880 560 |
| 8 | 滚轮 / ＋－ 缩放 | ✅ | 2 次＋ → 2.4×，viewBox 360.4×229.4；倍率读数同步 |
| 9 | hover 信息卡 | ✅ | 标题「天健苑·体育中心」+ 类别/通高/容量/风险 行；缩放后清除不残留 |
| 10 | 375px 无横滚 + 触控 | ✅ | 同源 iframe 375：scrollWidth=371、wrap 321、zoom 按钮 44×44×3、图例 right=281≤375 |
| 11 | 双主题 AA（新增组件） | ✅ | §3.3 两表全 ≥4.5；zone-name 为装饰水印豁免 |
| 12 | 键盘焦点环 / Enter/Space/Esc | ✅ | 复用 D2 机制，focus-ring 改挂屋顶轮廓；:focus-visible 触发 |
| 13 | 示例回放无回归 | ✅ | MapView t=300 灾情/警戒/救援/封路/积水标记全在；截图 d3-polish-mapview-regression.png |
| 14 | CD-04 合成 20 栋零改动 | ✅ | #panel-cd04：20 栋/20 屋顶/20 侧壁、viewBox 48 56 892 634、counts 20/3/29；截图 d3-polish-cd04-20.png |
| 15 | 徽标 / 精度声明同屏 | ✅ | 推演/示例回放/诊断徽标 + 页脚 PRECISION_NOTICE 未动 |

### 3.3 新增组件双主题对比度（rgba 沿祖先背景链 alpha 合成；SVG 读 fill、背景取 stage-bg）

**ops（夜航）**：b-name 16.93、b-meta 7.63、hc-title 16.93、hc-line 7.63、lg-item 16.93、map-btn 16.93、map-zoom-level 7.63、north 10.93、scalebar 7.63 —— 全 ≥4.5。

**daylight（日光）**：b-name 13.30、b-meta 5.01、hc-title 13.30、hc-line 5.01、lg-item 13.30、map-btn 13.30、map-zoom-level 5.01、north 5.80、scalebar 5.01 —— 全 ≥4.5。

**豁免说明**：`.zone-name`（分区水印）daylight 实测 1.12，属纯装饰背景文字（`aria-hidden="true"`、pointer-events:none），WCAG 1.4.3 豁免；信息性分区由 ObjectDetail「分区」字段承载（AA）。沿用 D2 对 giant 水印的同口径处理。

### 3.4 截图清单（assets/）

| 文件 | 内容 |
| --- | --- |
| d3-polish-before-flat.png | 改前纯色块地图（粗糙基线） |
| d3-polish-25d-ops.png | 改后 2.5D 体量（夜航） |
| d3-polish-selected-zoom-hover.png | 选中发光 + 2.4× 缩放 + hover 信息卡 |
| d3-polish-daylight.png | 日光主题 2.5D + 选中态 |
| d3-polish-mapview-regression.png | 示例回放 t=300 标记无回归 |
| d3-polish-cd04-20.png | 诊断台 CD-04 合成 20 栋体量渲染 |

### 3.5 边界与已知取舍（诚实记录）

- **不改 A 数据**：footprint 仍为 fixture 矩形 polygon；2.5D 是渲染风格化，不伪造真实几何/高度。想要非矩形真实轮廓需 A 数据修订（20 栋补齐时一起、需重新冻结），B 渲染零改动受益。
- **高度仅视觉比例**：massHeight 由层数派生，不对外标注为实测高度（CD-06）；页脚精度声明未动。
- **touch-action:none**：地图区域单指拖拽平移，代价是手指落在地图上时不滚动页面（需从信息轨滚动）。375px 上下分栏仍可整页纵向滚动（rail 区域）。
- **hover 卡为 pointer 定位**：键盘 focus 以元素中心定位；缩放/拖拽/复位即清除，避免过期坐标。
- 未实现双指 pinch 缩放（以 ＋/－ 按钮与滚轮覆盖）；未做标签碰撞避让（当前 8/20 栋布局无重叠，SVG 标签随 viewBox 等比缩放，相对关系不变）。

## 4. 结论与后续

地图从「纯色块示意图」升级为「2.5D 体量校园沙盘」，可操控性补齐缩放/平移/复位/hover/选中强化/图上圖例。双主题 AA、375px、键盘、CD-04、示例回放、check:d1-v2 全部复测通过，控制台 0 报错。**仍待 A**：真实非矩形 footprint 与 20 栋选点、D3 规则引擎、D4 评分器。**仍待 D4**：完整动作面板/排序交互/实时评分。

## 5. 待补凭证

- [ ] 用户手动补拍：地图精致化方向讨论与 2.5D 实现对话截图 → `assets/d3-polish-chat-01.png`
- [ ] 用户手动补拍：指针捕获回归自查修复对话截图 → `assets/d3-polish-chat-02.png`