# D4+ · 2026-11-18 · 校园沙盘重设计：建筑事务所实体比例模型

| 项 | 内容 |
| --- | --- |
| 责任人 | B |
| 轨道 | 界面侧 |
| 关联功能 | FR-4（地图渲染与图层）、FR-8（训练定位标注不变）、CD-04/CD-06（20 栋零改动、高度仅层数视觉比例） |
| 状态 | 已完成（视觉与交互实测通过；临场判定/评分仍待 A，未伪造） |

## 1. 想完成什么

用户附 DOCX  brief：把当前推演页校园沙盘重做成**建筑事务所实体比例模型**——正交斜俯视（约 35–45°）同时看见屋顶与立面；哑光暖白/浅灰体量 + 克制的分类立面节奏；去掉芯片图钉、金色底条、发光描边、重复矩形框与设备面板感；统一左上柔光、清晰而软的投影与接触阴影；薄暖灰模型底台边、浅灰米地面、雾灰背景、轻微悬浮感；连续浅灰路缘道路与自然路口；有依据的广场/铺装/庭院；低饱和鼠尾草绿化、完整草坪地块、统一简单体积树冠沿路成组；应急信息改为**悬浮指挥标记覆盖层**（灾情标记 + 局部风险范围、封路障符号、简洁救援标记；红/橙/蓝只承载状态）；**去掉整栋类别着色**；选中 = 干净轮廓/地面高亮，无持久发光；动效只用于事件出现/选中/动作；标注独立屏幕空间层、字号恒定、薄底衬、总览只留地标、hover/选中展开；地图控件改为边缘小型悬浮件，中心留给校园；右侧推演面板保持深灰全功能。先评估 SVG/Canvas/WebGL 再选真正能实现体量/遮挡/光照的方案（brief 允许在 SVG 不足时引入合适 3D，禁止 CSS 阴影假装体积）；**保留全部数据绑定、楼栋/道路点选、灾情图层、回合推进、缩放平移，点击必须映射回原业务对象**；默认视图先是一个完整漂亮的校园；跑既有检查并给真实运行截图（至少总览 + 选中建筑近景）。

## 2. 在 Qoder 中做了什么

- 对话截图：待补（用户手动补拍 Qoder 界面）
- 生成结果截图：
  - [`assets/sandbox-model-overview.png`](assets/sandbox-model-overview.png) —— 夜航指挥主题、重置回合 1 的校园总览（默认视图）
  - [`assets/sandbox-model-selected-closeup.png`](assets/sandbox-model-selected-closeup.png) —— 选中「文博苑·逸夫图书信息中心」+ 2.0× 近景
  - [`assets/sandbox-model-t300-marks.png`](assets/sandbox-model-t300-marks.png) —— t=300 五枚指挥标记叠放 + 路况双态
  - [`assets/sandbox-model-daylight.png`](assets/sandbox-model-daylight.png) —— 教室投影·日光主题总览

### 2.1 渲染方案评估与选择

先评估三条路线：**WebGL/Three.js** 能真做光照但引入新依赖、需重写全部点选/图层/标注绑定且与冻结 viewBox 契约冲突；**Canvas** 需自建拾取与无障碍树；**增强 SVG 斜正交投影**用真实投影数学 + 画家算法排序 + 高斯模糊阴影即可实现体量、遮挡与统一光照，零新依赖、全部既有绑定原样保留。实测效果达到 brief 的体积/遮挡/光照要求（见 §3 截图），故**未引入 3D 依赖**——brief 的 3D 许可是「SVG 不足时」的条件授权，条件未触发。

投影仅渲染器内部：`KY=0.574`（地面 y 压缩 = cos55°）、`KZ=0.819`（高度抬升 = sin55°），`proj(x,y,z)={x, y:y*KY−z*KZ}`，仰角约 35°。`port.map` / fixture 平面几何 / viewBox 契约（"40 40 880 560"、GATE3=(500,520)）**零改动**，validate 脚本仍全过。

### 2.2 重写 `src/components/CampusMap.vue`（约 1050 行，props/emits 不变）

- **体量**：`massHeight(floors)=14+min(floors,8)*5`（null→2，仅层数视觉比例，CD-06）；`wallFaces` 取外法线 ny>0 的立面，`renderVolume` 产出墙/窗带/屋顶/檐口。分类节奏：宿舍长条 + 重复窗带（bandRows=min(层数,6)）+ 清晰檐口；教学/实验主楼 68% 宽 + 0.55h 副楼；食堂低宽 0.72h + 入口雨棚；体育馆大连续屋顶 1.05h；图书/办公基座（ring 1.05、h3）+ 西北塔楼 1.3h。入口 = 南立面凹龛（0–0.42h）+ 雨棚板 +  fascia。屋顶设备盒按分类少量点缀。
- **光照**：统一左上柔光——立面渐变 `#cfc7b8→#a99f8d`、屋顶渐变 `#f8f5ef→#e9e4d9`；投影 `proj(p.x+h*0.7, p.y+h*0.5)` 偏移 + 模糊 3.2（cast .3）与接触阴影模糊 1.4（.35）；**全文件无发光滤镜**。
- **底台与环境**：薄暖灰模型底台（top `#e7e1d4` / front `#a89e8c` / side `#b8af9d` + 落影 .25）产生轻微悬浮感；舞台雾灰 `#cfcdc7`（console.css）。环境**纯几何推导、无业务含义**：草坪 = 自由单元格贪心网格（cell 26、inset 16、roadDist>12，上限 10 块）；广场 = 教学/图书/办公/食堂南侧 5×3 自由采样（depth 24）+ 分缝线；树 = 沿每路段每 34 单位、路缘外 ±19 垂直布点 + 草坪边缘，去重 <17、上限 110，3 种径向渐变鼠尾草树冠 + 树干 + 接触椭圆。道路连续路缘 17 / 路面 13（平面恒定宽）+ 中心虚线，路口自然衔接。
- **画家算法**：`sceneObjects`（building/junction/tree）按深度升序（building box.maxY / junction pos.y / tree y）；地面层（底台→景观→道路→阴影）先画；标记与标注在最上屏幕空间层。
- **指挥标记覆盖层**：`MARK_DY={disaster:0, cordon:−26, rescue:−52, hazard:0, closed:−34}` 垂直错叠防堆字；灾情蓝 `#2f6fb0` + 地面虚线风险环 1.12、警戒橙 `#c07a2a` + 环 1.24、救援绿 `#4a7c59`、封路红 `#b3402e` + 障符号；`transform=translate(m.x, m.y+dy*screenScale) scale(screenScale)` 屏幕恒定；唯一动效 `mark-in .28s`（事件出现）。
- **选中/悬停**：石墨色檐口描边 `#37332c` 2.2 + 地面环 `#4a453c` 2（.85），无持久发光；hover 卡浅色。
- **标注屏幕空间层**：`labelPlan` LOD——总览（zoomLevel<1.35）仅 prio≤1 + 地标（footprint 面积前 4 + 校门），重叠抑制；选中/hover/屏宽≥120 展开层数·容量副pill；`scale(screenScale)` 字号恒定；pill `#fbfaf6` .92 薄底衬。
- **视图机器保留**：viewBox-only 缩放/平移（投影空间）、`zoomAt` 钳制 base.w/5…base.w/0.7、滚轮/指针拖拽（movedRecently + 拖拽后才 pointer capture）、双击复位；道路命中区屏幕恒定 20*screenScale。
- **控件边缘化**：`.map-zoom` 左中（44px ＋－⤾ + 倍率）、`.map-orient` 右上 top:110（N▲ + 比例尺「示意比例·非实测」）、`.map-minilegend` 左下**仅状态**（通行/灾情/封闭/警戒/救援，无类别色块）。

### 2.3 `src/styles/console.css` 配套

`.map-stage` 改 `border:1px solid #c6c3bb; background:#cfcdc7`（删深色径向晕染）；`.stage-frame{display:none}`（删四角括号，DrillView/MapView 共用）；新增浅色舞台 HUD 块（pill `rgb(251 250 246/.86)`、文字 `#33302a`/`#6b6353`、badge-blue/red 浅底深字）；`@media (max-width:640px)` 隐藏 `.hud-br`/`.hud-tr`/比例尺防 375 碰撞。D4 动作卡横溢修复保留。

### 2.4 人工修改与迭代

10 轮浏览器截图迭代（scratch `.sandbox-shots/`，已清理）：iter1/2 「纸拼贴」发白 → 仰角 35° + 加高体量 + 加深立面/檐口/阴影/道路/树冠 + 底台色调分离；iter2 HUD 碰撞 → 控件移位；iter7/8 标记堆字 → MARK_DY 错叠 + closed −34；草坪上限误设 208 导致地块消失 → 提至 286。两次自输 hex 混入西里尔字母（`#38604а`/`#75866а`）→ 修正并全文件非 ASCII hex 扫描确认干净。

## 3. 如何验证

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 默认总览 = 完整漂亮校园 | 浏览器截图（夜航 + 日光两主题） | 通过：20 栋体量 + 3 路口 + 道路网 + 底台完整可见，屋顶/立面/投影/接触阴影齐全，无类别整栋着色、无图钉/金条/发光 |
| 场景元素实测计数 | 浏览器 DOM 计数 | buildings=20、junctions=3、trees=110、lawns=10、plazas=3；重置 viewBox="-28 -82.5 1466 693.31"、1.0× |
| 总览 LOD 标注 | 浏览器 DOM | 6 枚：萃园 7 幢（北 7）/天健苑·体育中心/文博苑·逸夫图书信息中心/南馆 A 座（顶部钟楼）+ 4 号门（近东区）/南门（名义正门）；字号屏幕恒定 |
| 选中建筑近景 | 合成 click 楼栋 group + 3× zoom-＋ 后截图 | 通过：石墨檐口 + 地面环、副pill「5 层 · 容量≈2500」、rail R1 同步「文博苑·逸夫图书信息中心 · 楼栋 · 已选中」、设为路径起点/终点可用；aria-label 含「已选中」 |
| t=300 指挥标记叠放 | 点击回合 chip 300 后 DOM 计数 + 截图 | 5 枚：disaster「北 7 三层确认为真实火情 @90」/cordon「警戒已就位 @130」/rescue「救援队已到达 @160」/hazard「积水 @140」/closed「封闭·seq17」，垂直错叠可读；ROAD STATUS「灾情 1 封闭 1」 |
| t=30 无标记（可见性切割不回归） | 浏览器 DOM | marks=0，与 FR-4.1 一致 |
| 缩放/平移/复位/点选绑定 | 浏览器实操（本轮及前序迭代） | 通过：zoom 钳制、拖拽平移、双击复位、楼栋/道路/路口点击均映射原业务对象（rail/详情同步）；路径线投影渲染带白 casing + 端点 |
| 375px 响应式 | 同源 iframe 375×720 真实媒体查询 | scrollWidth=375=clientWidth 无横滚；舞台 347px；hud-br/hud-tr display:none；zoom 按钮 44×44；20 栋 + 6 标注完整 |
| 新增浅色 HUD/标注/标记对比度 | Node WCAG 相对亮度计算（pill .92 / HUD .86 alpha 合成到雾灰 `#cfcdc7`） | 全 ≥4.5：name 12.16、meta 5.49、HUD 文字 11.94、hud-label 5.39、蓝 6.60、橙 5.19、绿 6.60、红 5.26 |
| 控制台 | list_console_messages | 0 error（仅 vite connecting/connected debug） |
| 基线门禁复跑 | CLI 全输出存档 | check:d1-v2 EXIT=0（83/44/90 未动）、check:d2 EXIT=0（RE-06 t139 直达 120px / t140 经 N1 660.04px / GATE3 全封闭 unreachable）、typecheck:app EXIT=0、build 50 modules（CSS 46.21 kB / JS 251.07 kB） |
| A 冻结文件零改动 | git status 核对 | contracts.ts / fixture-port.ts / fixtures/*.json / schema.sql / validate-*.ts 未改；投影仅渲染器内部 |

- 门禁完整输出：[`sandbox-model-gates.log`](sandbox-model-gates.log)
- 验证截图：§2 四张 assets 截图（总览 / 选中近景 / t300 标记 / 日光主题）

## 4. 结论与后续

达成 brief：默认视图即完整实体模型校园；体量/遮挡/统一光照由真实投影 + 画家排序 + 模糊阴影实现（非 CSS 假体积）；类别整栋着色、图钉、金条、发光、设备框全部移除；应急信息为状态色指挥标记覆盖层；标注屏幕空间恒定；控件边缘化；全部业务绑定与视图交互保留；双主题 + 375 + 门禁全过。**未引入新依赖**（SVG 方案实测 sufficient，3D 条件授权未触发）。

后续：A 的 D3 规则引擎 / D4 评分器仍未交付——动作合法性、拒绝原因、临场评分继续恒 pending 占位，未伪造；D4 里程碑闭环仍阻塞于 A（非 B 可行动）。真实非矩形轮廓待 A 提供后替换 footprint（当前仍为冻结矩形平面 + 渲染器体量）。

## 5. 待补凭证

- [ ] 用户手动补拍本次沙盘重设计的 Qoder 对话截图（助手无法代截界面）