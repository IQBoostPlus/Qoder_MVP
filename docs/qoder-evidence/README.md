# Qoder 使用过程凭证

本目录留存本项目**每一步**的 Qoder 使用证据，供 README「Qoder 使用过程与凭证」章节与天池作品帖引用。

赛题硬性要求：开发与部署均由 Qoder 完成，作品帖须说明使用过程并尽量多包含截图凭证。**证据必须当时留存，不得事后补。**

## 记录格式

每条凭证回答三个问题，并附对话截图与结果截图：

1. **想完成什么** —— 本步骤目标
2. **在 Qoder 中做了什么** —— 实际交给 Qoder 的操作与生成内容
3. **如何验证** —— 验证方式与结果

新建条目请复制 [`_template.md`](_template.md)。

## 命名与归档

- 文件名：`D{n}-{YYYY-MM-DD}-{步骤 slug}.md`，例如 `D1-2026-11-18-sites-spike.md`
- 截图放 `assets/`，文件名与条目对应，例如 `assets/D1-sites-spike-chat.png`
- 纯 CLI 验证无法截图时，保存命令与**完整输出文本**作为等效凭证，并在条目中注明原因
- 用户手动操作 Qoder 的对话截图由用户补拍，助手无法代为截取界面

## 责任划分

| 责任人 | 轨道 | 覆盖范围 |
| --- | --- | --- |
| **A** | 引擎侧 | 建表读写、Agent 生成及回退、计分重算 |
| **B** | 界面侧 | 地图与动作联动、响应式适配、公开部署 |

## 凭证索引

随进度追加。状态：`待采集` / `已留存` / `已引用`。

| 日期 | 步骤 | 责任人 | 条目 | 状态 |
| --- | --- | --- | --- | --- |
| D0 · 11/17（规划期） | 校园建筑数据真实化 + 手算样例三处矛盾对齐（v4.1） | A + B | [D0-2026-11-17-campus-data-v41.md](D0-2026-11-17-campus-data-v41.md) | 已留存（对话截图待补） |
| D1 · 11/17 | 契约/fixture/校验器/DDL 对齐 v4.1 真实校区，复算 83/44/90 | A | [D1-2026-11-17-canonical-data-alignment.md](D1-2026-11-17-canonical-data-alignment.md) | 已留存 |
| D1 · 11/17 | D1-v2 只读接口（地图/可见性/回放/道路/静态评分）+ 五项跨轨审计记录 | A | [D1-2026-11-17-engine-port.md](D1-2026-11-17-engine-port.md) | 已留存（Qoder 对话截图待补） |
| D1 · 11/17 | `npm run check:d1-v2` 完整输出（含原 D1 回归） | A | [d1-v2-local-validation.log](d1-v2-local-validation.log) | 已留存 |
| D1 · 11/17 | `npm run check:d1` 类型检查与 fixture 复算完整输出 | A | [d1-local-validation.log](d1-local-validation.log) | 已留存 |
| D1 · 11/17 | Sites 建表 / Function 内读写 / Cloud Agent 连通性 spike | A | [d1-cloud-verification.md](d1-cloud-verification.md) | 已留存（DB 与 Agent 均通过；重试限制已记录） |
| D1 · 11/17 | Function 内数据库读写结果截图 | A | [d1-function-db-success.png](d1-function-db-success.png) | 已留存 |
| D1 · 11/17 | 契约冻结（类型 + fixture + DDL + 权重 + 模拟时钟）+ **手算样例** + **8 栋真实选点 fixture** | A + B | [A 基线](D1-2026-11-17-canonical-data-alignment.md) · [B 草案与冻结核对](D1-2026-11-17-contracts-fixtures.md) | 已留存（**已冻结**，以 A 基线 e9d4a07 为准；B 独立复核见条目 §6） |
| D1 · 11/17 | 前端骨架（Vite+Vue3+TS）+ 接入 A 只读接口 + 浏览器侧 16 项验证 + 五项跨轨答复 | B | [D1-2026-11-17-frontend-port-integration.md](D1-2026-11-17-frontend-port-integration.md) | 已留存（对话截图待补；静态接入，实时评分待 A） |
| D1 · 11/18 | 项目骨架 + SVG 渲染 fixture 8 栋 + 响应式栅格 + 首屏声明 | B | [D1-2026-11-17-svg-map-responsive.md](D1-2026-11-17-svg-map-responsive.md) | 已留存（对话截图待补；静态渲染，点选/实时评分待 D2/D4） |
| D1 · 11/17 | 指挥舱改版：整屏零滚动 + 视觉重做（含 375px 舞台塌缩修复） | B | [D1-2026-11-17-console-redesign.md](D1-2026-11-17-console-redesign.md) | 已留存（对话截图待补；基线 exit 0） |
| D1 · 11/17 | 双主题换肤：夜航指挥（默认）/ 教室投影·日光纸面，token 化 + 持久化切换 | B | [D1-2026-11-17-dual-theme.md](D1-2026-11-17-dual-theme.md) | 已留存（对话截图待补；对比度缺陷已闭环） |
| D1 · 11/18 | 安装 anti-slop skill（design-taste-frontend）+ 界面去 AI 味精修 + 楼栋清单可读口径 + 320px 裁切修复 | B | [D1-2026-11-18-skill-deslop.md](D1-2026-11-18-skill-deslop.md) | 已留存（对话截图待补；双主题 1280/375/320 实测通过，基线 exit 0） |
| D2 · 11/19 | 按 requirements §7.2 补齐 **20 栋真实建筑** + 路段邻接 + Dijkstra + 阻断重算 | A | — | 待采集 |
| D2 · 11/18 | 地图点选 + 图层 + 路径线 + 阻断标记 + 375px 实测 | B | [D2-2026-11-18-map-interaction-layers.md](D2-2026-11-18-map-interaction-layers.md) | 已留存（对话截图待补；30 项实测 + CD-04 构造验证；RE-06 真实改道待 A，实时评分待 D4） |
| D3 · 11/20 | 规则引擎 6 动作 + 单测 | A | — | 待采集 |
| D3 · 11/20 | 推演页布局 + 回合状态机/时间轴 + 控速播放 + 分批投放 + 回合内自由行动时机框架 | B | [D3-2026-11-18-drill-rounds-playback.md](D3-2026-11-18-drill-rounds-playback.md) | 已留存（对话截图待补；32 项实测 + 双主题 AA；动作真实判定/评分待 A，完整动作面板/排序交互/实时评分待 D4） |
| D3+ · 11/18 | 地图 2.5D 体量精致化 + 缩放/平移/hover/选中强化/图上圖例（回应「粗糙/可操控性差」反馈） | B | [D3-2026-11-18-map-25d-interaction-polish.md](D3-2026-11-18-map-25d-interaction-polish.md) | 已留存（对话截图待补；交互/375/双主题 AA/CD-04/示例回放复测全过；不改 A 冻结 footprint，真实轮廓与 20 栋待 A） |
| D4 · 11/21 | 评分器四指标 + 单测 + **双分支 83/44 实时计算里程碑** | A | — | 待采集 |
| D4 · 11/21 | 动作面板 + 信息流 + 甄别与改判 + 末回合排序 + **同剧本双分支里程碑** | B | — | 待采集 |
| D5 · 11/22 | Agent 剧本生成 + Schema 校验 + 兜底 | A | — | 待采集 |
| D5 · 11/22 | 复盘页 + 首次公网部署 + 同学试用反馈 | B | — | 待采集 |
| D6 · 11/23 | Agent 整批上报 + 真值标签落库 | A | — | 待采集 |
| D6 · 11/23 | 集成日：fixture 换真实引擎与 DB | B | — | 待采集 |
| D7 · 11/24 | 复盘文案 Agent + 输出过滤 + 异步超时摘要 | A | — | 待采集 |
| D7 · 11/24 | 档案列表 + JSON 导出 + 预置案例 + 演示模式 | B | — | 待采集 |
| D8 · 11/25 | AI 方法论 / 评分权重 / 数据来源文档 | A | — | 待采集 |
| D8 · 11/25 | 3 分钟视频 + UI 截图 + 性能实测 | B | — | 待采集 |
| D9 · 11/26 | P0 修复 + 引擎单测回归 | A | — | 待采集 |
| D9 · 11/26 | P0 修复 + 移动端与控制台回归 + 作品帖文案 | B | — | 待采集 |
| D10 · 11/27 | 功能冻结 + 全链路回归 + README 定稿 | A + B | — | 待采集 |

## 关联

- 规划与排期：[`README.md`](../../README.md)（v4.1，2 人 10 天）
- 功能与评分规则：[`docs/requirements.md`](../requirements.md)（§5 手算样例、§7 校园 20 栋选点）
- 质量与验收用例：[`docs/quality-verification.md`](../quality-verification.md)
- 建筑原始调研：[`docs/njit-campus-buildings.md`](../njit-campus-buildings.md)
- 记忆约定：`qoder-evidence-convention`（项目记忆，每步强制留存）