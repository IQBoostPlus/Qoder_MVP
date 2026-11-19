# D3+ · 接入 A 的 D2 交付 + 类别识别形象（二次元风格建筑/校门）

- 日期：2026-11-18（D3+，排期 D3 11/20 之前提前）
- 责任人：B（界面侧）
- 关联：A 交付 `d806ba3`（D2 路由引擎 + 数据库迁移 + 验证）；B 基线 `3499f32`（2.5D 体量精致化）

## 1. 想完成什么

1. 把 A 的 `d806ba3` 接进 B 工作树，让默认数据源从 8 栋 fixture 切到 **20 栋真实校园地图 + 真实 Dijkstra 路径**，并复测 B 侧渲染/交互不回归。
2. 回应「2.5D 想要食堂/宿舍/教室/大门的二次元形象」：在**不改 A 冻结 footprint、不加依赖、不做 3D** 的前提下，于渲染层为每个类别画识别性插画形象（窗阵/雨棚/蒸汽/拱顶/山花/旗帜/水箱/通风管/徽标），校门路口画成双柱重檐牌坊式校门。

## 2. 在 Qoder 中做了什么

### 2.1 接入 A（fast-forward，零冲突）

- `git merge --ff-only origin/main`：`3499f32 → d806ba3`（A 提交本就是 B polish 的后代，无冲突）。
- 默认端口切换由 A 完成：`useFixturePort` 改用 `createEnginePort(fixture, campus-map.json)`，`getRoute = findRoute`（真实 Dijkstra）。B 沿用 A 的 `formatBuildingFloors`（ gym null=通高 / 其他 null=未公开）。
- B 未改 A 冻结文件（contracts / fixture-port / fixtures / schema / validate-*）。

### 2.2 类别识别形象层（`src/components/CampusMap.vue`）

- 新增 `buildingArt(category, id, box, h, rc, floors)`：**全部几何由 footprint bbox + 层数 + category 派生**，不硬编码任何楼栋 id/坐标。
  - 通用：南墙窗阵（ cols 按宽度 3/4，rows=min(层数,4)，亮窗由 `(r*cols+c+id.length)%3` 决定，确定性非随机）。
  - 食堂 canteen：条纹雨棚 + 扇贝边、屋顶烟囱、3 缕上升蒸汽（动画）。
  - 宿舍 dormitory：屋顶水箱。
  - 体育 gymnasium：大跨拱顶（二次贝塞尔）。
  - 图书 library： front 山花 + 4 根壁柱（取消窗阵）。
  - 实验 laboratory：屋顶通风管 ×2。
  - 教学 teaching：旗杆 + 飘动红旗（动画）。
  - 办公 office：密集窗阵（curtain wall）。
- 新增 `EMBLEM_PATH`（按 category 的线描徽标：床/碗蒸汽/书/书堆/球/烧瓶/公文包/通用），屋顶右上角圆形徽章承载。
- 校门 `junction.kind === 'gate'`：双柱 + 重檐（amber 下檐 / red 上檐）+ 匾额 + 两盏呼吸灯笼，替换原单线 gate-glyph。
- 动画：`steam-rise` / `flag-wave` / `lantern-glow`，均为可见元素的轻微 idle，不产生噪声。
- 颜色全走主题 token；修正首版误用的未定义 token（ink-100/300/500/700 不存在）→ 改用 `--halo / --paper / --muted / --ink-800 / --line`，双主题自动翻转。

## 3. 如何验证（真实浏览器 + CLI 门禁）

### 3.1 CLI 门禁（完整输出见同目录日志）

- `npm run typecheck:app`：exit 0。
- `npm run build`：exit 0（css 44.13 kB / js 234.76 kB）。
- `npm run check:d1-v2`：通过（甲 83 / 乙 44 / 拒判 [14,20]·[9,14,15] / 1×4× 45s / 硬编码扫描 clean）。
- `npm run check:d2`：PASSED。RE-06 真实改道：t139 直达 120px → t140/164/165 改道 660.04px（N7→N1→GATE3）；GATE3 全封闭→unreachable→恢复 ready。

### 3.2 浏览器结构化/数值实测（dev server 重启后，console 仅 vite debug，0 error）

| 项 | 结果 |
| --- | --- |
| 推演舱楼栋数 | 20（真实校园地图） |
| 形象元素 | 窗 256 / 亮窗 84 / 徽标 20 / 雨棚 3 / 蒸汽 9 / 拱顶+山花 2 / 旗 3 / 水箱 6 / 校门 3（柱 6） |
| 真实改道（UI） | 选终点 GATE3 后 @t220：`2 段 · 图上长度 660.0 px`，链 `北7 → 3号门`，route-line 折点 `380,520 220,500 180,500…`（与 RE-06 门禁一致） |
| 滚轮缩放 | viewBox `6 6 1398 978 → 122.4 87.5 1165 815`，zoom 标签 1.2× |
| hover 卡 | `萃园7幢（北7）· 宿舍 · 5层 · 容量≈500 · 风险 · 灾情` |
| 点选 | sel-tag=1（形象层未破坏 pointer 目标） |
| 375px iframe | 20 栋 / 20 徽标 / 3 校门 / 256 窗，svg 325×309 落于 wrap 325，无横向溢出 |
| CD-04 零改动 | 诊断台合成 20 栋：20 徽标 / 177 窗 / 2 校门，同一 CampusMap.vue |
| 地图页回归 | MapView 同样渲染 20 栋 + 形象 |
| 徽标对比度 | ops 10.91:1（深描边/亮类别底）；daylight 4.27:1（浅描边/深类别底） |
| 双主题 token | 蒸汽/旗杆=--muted、水箱=--ink-800、窗=--halo、亮窗=--amber，均随主题翻转，无未定义 var |

### 3.3 诚实边界

- **结果截图待补**：本轮内置浏览器面板处于隐藏态（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），无法截 PNG；以上以结构化断言 + 计算样式 + CLI 完整输出为等效凭证。打开面板后可补 `assets/d3-art-20-ops.png` 等。
- 形象为**风格化插画**，非实测建筑立面；几何仍 100% 来自 A 冻结 footprint，层数只做视觉比例。首屏「训练级精度 / 非实测」声明保留，未把插画当测绘。
- 未加任何依赖、未做 3D、未改 A 冻结数据；类别键控（category / junction.kind），CD-04 换 20 栋零改动成立。
- 已知小项（沿用 D3，待 D4）：`resetDrill` 不重置 realElapsedMs/startMark；`submitVerdict` 守卫用单调 deliveredIds。

### 3.4 「地图挤一起 / 道路重叠」修复（渲染层 LOD，不动 A 数据）

先核实前提：`fixtures/campus-map.json` 20 栋 bbox **两两相交 0 对**、路段穿楼 0 对、内容占视框 89%×86% —— 数据不挤。挤的观感来自**中心校区密集 + 全量标注同时渲染 + 缩略时路线虚线叠成噪点 + 可无限缩小**。修复全在 B 渲染层：

- **恒定屏幕字号**：名称/明细/风险/路口/分区/标注/选中标签的字号与描边按 `screenScale = view.w / wrapWidth` 换算，任何缩放下屏幕字号恒定（名称 12px），放大时建筑变大而字不变 → 自然疏解。
- **标注消隐（declutter）**：按 选中 > 悬停 > 占地面积 贪心放置屏幕矩形，相撞者隐藏名称（hover 卡仍可查看）；明细/风险仅在 建筑屏幕宽 ≥120px 或 选中/悬停 时展开。
- **道路分级**：肩/面/中心线宽恒定屏幕（8/4.5/1.2px）；中心虚线仅 zoom ≥1.5× 显示；高亮改描边色而非加宽（避免 inline 宽度覆盖失效）。
- **缩放钳制修正**：zoom ∈ [0.7×, 4×]（首版误写反导致可缩到 0.25× 成一团，已修正）。
- 灾情/警戒/救援标记与选中标签加 `scale(screenScale)`，缩放下保持屏幕尺寸。

实测（dev server，console 0 error）：

| 视图 | 名称数 | 明细数 | 中心虚线 | 名称屏幕矩形相交 |
| --- | --- | --- | --- | --- |
| 1.0× | 20 | 4 | 0 | 0 |
| 0.7×（缩略下限） | 16 | 0 | 0 | 0 |
| 4.0×（放大上限） | 20 | 20 | 28 | 0 |
| 375px iframe | 9 | 0 | 0 | 0（无横向溢出） |

双主题名称：ops 浅字+深 halo / daylight 深字+浅 halo，均可读。`typecheck:app` / `build` / `check:d1-v2` 复跑通过。

## 4. 凭证

- CLI：`d1-v2-local-validation.log` / `d2-routing-validation.log`（A 留存，本轮复跑一致）。
- 截图：待内置浏览器面板可见后补拍（对话截图由用户补）。