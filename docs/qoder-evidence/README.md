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
| D2 · 11/18（排期 11/19） | 20 栋训练地图、Dijkstra、真实改道、数据库候选迁移 | A | [D2-2026-11-18-routing-engine.md](D2-2026-11-18-routing-engine.md) | 已留存（CLI、1440px / 375px 浏览器、本地 PostgreSQL 已验；云端冻结已验，见云端验收；并发原子性待验） |
| D2 · 11/18 | 私有站登录后 D1 数据库连通性复验、Sites 方言适配 | A | [D2-2026-11-18-cloud-recheck.md](D2-2026-11-18-cloud-recheck.md) | 当时状态：D1 云端读写通过，D2 云端迁移及 Agent 复用未执行；后续见云端验收 |
| D2 · 11/18 | 八表迁移、结构冻结、20 / 28 地图云端往返、私有 Function 发布、Agent 持久复用 | A | [D2-2026-11-18-cloud-acceptance.md](D2-2026-11-18-cloud-acceptance.md) | 已留存（迁移 / 地图 / Agent 通过；并发原子性、真实断流、第 5 次兜底、配额待验） |
| D2 · 11/18 | 地图点选 + 图层 + 路径线 + 阻断标记 + 375px 实测 | B | [D2-2026-11-18-map-interaction-layers.md](D2-2026-11-18-map-interaction-layers.md) | 已留存（对话截图待补；30 项实测 + CD-04 构造验证；RE-06 真实改道待 A，实时评分待 D4） |
| D3 · 11/18（排期 11/20） | 六动作规则、学员流水快照与页面接入 | A | [D3-2026-11-18-action-engine.md](D3-2026-11-18-action-engine.md) | 已留存（CLI、三条流水重判、桌面与 375px 浏览器通过） |
| D3 · 11/20 | 推演页布局 + 回合状态机/时间轴 + 控速播放 + 分批投放 + 回合内自由行动时机框架 | B | [D3-2026-11-18-drill-rounds-playback.md](D3-2026-11-18-drill-rounds-playback.md) | 已留存（对话截图待补；32 项实测 + 双主题 AA；动作真实判定/评分待 A，完整动作面板/排序交互/实时评分待 D4） |
| D3+ · 11/18 | 地图 2.5D 体量精致化 + 缩放/平移/hover/选中强化/图上圖例（回应「粗糙/可操控性差」反馈） | B | [D3-2026-11-18-map-25d-interaction-polish.md](D3-2026-11-18-map-25d-interaction-polish.md) | 已留存（对话截图待补；交互/375/双主题 AA/CD-04/示例回放复测全过；不改 A 冻结 footprint，真实轮廓与 20 栋待 A） |
| D3+ · 11/18 | 接入 A `d806ba3`（ff）→ 20 栋真实地图 + 真实 Dijkstra；类别识别形象（食堂/宿舍/教室/大门等二次元插画）+ 校门牌坊；LOD 标注消隐/恒定屏幕字号/道路分级修「挤一起/道路重叠」 | B | [D3-2026-11-18-category-art-and-d2-integration.md](D3-2026-11-18-category-art-and-d2-integration.md) | 已留存（typecheck/build/check:d1-v2/check:d2 全过；RE-06 UI 改道 660px、20 栋形象、1×/0.7×/4×/375 标注 0 相交、双主题对比度实测；结果截图待面板可见补拍） |
| D4 · 11/19（排期 11/21） | 四项实时评分、窗口反馈、末回合排序和复盘 | A + B 接口 | [D4-2026-11-19-live-scoring.md](D4-2026-11-19-live-scoring.md) | A 本地验收 83 / 44 / 90 / 83；**B 轨独立复验已通过**（见下一行），真人试用签认待补 |
| D4 · 11/18（排期 11/21） | 动作面板 + 信息流 + 甄别与改判 + 末回合排序 + **同剧本双分支对照 83/44/90（示例回放）** | B | [D4-2026-11-18-actions-feed-sort-branches.md](D4-2026-11-18-actions-feed-sort-branches.md) | 已留存（§3 独立复核 + 7 截图 + 双主题 AA；修复桌面动作卡横溢；合法性与临场评分待 A，未伪造。**11/19 更新**：已接 A 引擎，排序语义改为一次性 top-3、回看只读，本行的全 10 条可重提排序已废弃） |
| D4+ · 11/18 | 校园沙盘重设计：建筑事务所实体比例模型（SVG 斜正交投影 + 画家排序 + 统一柔光；去类别整栋着色/图钉/金条/发光；指挥标记覆盖层 + 屏幕空间标注 + 边缘控件） | B | [D4-2026-11-18-sandbox-architectural-model.md](D4-2026-11-18-sandbox-architectural-model.md) | 已留存（对话截图待补；4 截图 + 375/双主题对比度/门禁全过；零新依赖，业务绑定保留） |
| D4 · 11/19 | **B 轨独立复验 + 引擎合并**：checkpoint `d4c4c89` → merge `9775ccc`（A `ea7c9de`）；临场 scoreRound 接线、动作面板/信息流/双分支叠加、断电标记 + 标记防挤融合 | B | [D4-2026-11-19-b-independent-signoff.md](D4-2026-11-19-b-independent-signoff.md) | 已留存（四路径 83/90/44/83 逐项对齐契约；A5 改道 660px 与封备用路 unreachable 双例；同秒资源/拒绝占 seq/回看只读；4 档缩放标记标注 0 相交；375 无横滚；ops 6.76 / daylight 4.73；check:d4+build 全过；控制台 0 异常。对话与页面截图待补，以 [浏览器输出](d4-b-independent-browser.log) + [CLI 日志](d4-b-independent-gates.log) 为等效凭证） |
| D4 · 11/19 | **B 轨验收复验（验收单 1–70 逐条实测）+ 缺口补齐**：375 触控 44px、页面水印 24 span、MapView 空态时刻派生（CD-04）；修复后 check:d4/typecheck/build 复跑 + 生产 preview 复测；里程碑 90/83 一正一反复核 | B | [D4-2026-11-19-b-acceptance-reverify.md](D4-2026-11-19-b-acceptance-reverify.md) | 已留存（70 项本会话实测；ops 5.38 / day 4.71 全 ≥4.5；7 截图；[闸门日志](d4-b-acceptance-gates.log) POST-EDIT + FINAL REBUILD 段；dev 模板缓存陈旧已记录，建议重启 dev；对话截图待补） |
| D4+ · 11/19 | **夜战 HUD 整页重设计**（回应「页面太丑」）：材质 token 双主题、斜投影侧壁 + 离散亮窗 + 入口/路灯光池、雨幕/流光/信标、文案去内部编号；修复 375 舞台塌缩与 daylight 对比度 | B | [D4-2026-11-19-b-night-hud-redesign.md](D4-2026-11-19-b-night-hud-redesign.md) | 已留存（9 张 CDP 实拍截图；check:d4/typecheck/build 全过；ops 6.59 / day 5.04 全 ≥4.5；触控 0 违规；焦点环可见；控制台 0 错误；语义色与契约零改动） |
| D5 · 11/20（排期 11/22） | 复盘页三块（时间线/失误定位/预置摘要）+ 五步试用入口与场景卡 + 任务 0 五缺陷修复 + token 单一源 + 体验无障碍与 D2/D3/D4 回归 + **首次公网部署（任务 C 已执行）** | B | [D5-2026-11-20-review-deploy-trial.md](D5-2026-11-20-review-deploy-trial.md) | 已留存（§4–§9 逐项实测：构造 53/零操作 15、wait(0) 出分 7/10ms、27 对 × 双主题 AA、五断点零溢出、6 态 ×2 视口控制台 0 错误、回归全过；§11 公网部署：新站 public、匿名 401→200、产物逐字节一致、平台徽标避让修复、甲 83/乙 44 × 桌面/375 四组走查全过、T2 冷加载 4.6–6.5s 未达标如实记；[闸门日志](d5-b-gates.log)；40+ 截图；任务 D 试用待真实结果，见 §10/§11.7；向 A 的 9 个问题见 §7） |
| D5 · 11/20（排期 11/22） | 三模板、候选校验、模拟生成、预置回退与本地调用台账 | A | [D5-2026-11-20-scenario-generation.md](D5-2026-11-20-scenario-generation.md) | 本地通过；云端真实生成与复验见后续 D5 条目 |
| D5 · 11/20 | 私有站真实生成、耗时、并发与断流 | A | [云端验收](D5-2026-11-20-cloud-acceptance.md) | 真实生成、三次耗时与 Sites→Cloud 恢复已验；旧 Storage 并发终态曾失败；首段断流与超时/迟到此后在真实模式复验 |
| D5 · 收尾 | 干净目录构建、并发终态与默认关闭护栏 | A | [命令日志](d5-handoff-validation.log) | 本地通过；关闭护栏已部署核验 |
| D5 · 11/20 | 数据库台账迁移、关闭态部署与旧结果只读 | A | [闭门部署与台账核验](D5-2026-11-20-close-guard-deployment.md) | 已留存（三表迁移、开关关闭时回退、旧结果只读、0 行/0 发送） |
| D5 · 11/20 | 真实模式复验：同请求并发、预算与最后槽、两段断流、超时/迟到隔离 + 最终关闭 | A | [闭门部署 §9](D5-2026-11-20-close-guard-deployment.md#9-真实模式隔离复验与最终关闭2026-11-20) | 已留存（四项通过；真实发送 6 次含 1 次误发；累计 16；最终关闭已重新发布核验；跨实例同时写入与服务端超时未直接证明） |
| D6 · 11/21（排期 11/23） | 整批上报、冻结保存、恢复复算与导出 | A | [D6 记录](D6-2026-11-21-reports-and-persistence.md) | 已留存（本地与模拟通过） |
| D6 · 11/21 | A 私有站纯 DDL 迁移、同源轮次保存、两轮读写、负例、半写入与关闭态探针 | A | [云端验收](D6-2026-11-21-cloud-acceptance.md) · [两轮复算日志](d6-cloud-rounds.log) | 已留存；Stage 3 夜宿火情一批已跑通，实验楼超时回退，运行态已关闭；凭证不含令牌、Cookie、鉴权头或访问密钥 |
| D6 收尾 · 11/21 | 首次与追加半写入补测、真实预算对账、构建闸门、B 可复现源码包 | A → B | [收尾](D6-2026-11-21-closeout.md) · [验证日志](d6-closeout-validation.log) | 本机版可交付。真实三模板和 A 关闭版发布复验待补 |
| D6 · 11/21 | 补充末回合排序轮：提交、云端读回、刷新复盘与导出复算 | A | [排序轮复算日志](d6-sort-cloud-round.log) | 已留存（run `6510c384…`，revision 16，云端 `sort` seq 1；D5 调用 6/7/33 未变） |
| D6 · 11/23 | 集成日：fixture 换真实引擎与 DB | B | — | 待采集 |
| D6-v3 · 11/22 | B 站首写缺楼栋外键的修复、空库回归、Function 产物与公网复验单 | A → B | [首写修复](D6-2026-11-22-b-first-sync-fix.md) · [B 原发布记录](D6-2026-11-21-b-cloud-publish.md) | 修复已交付，公网待复验 |
| D6-v4 · 11/22 | 登录身份分桶、资源绑定恢复及 AI 生成回退 | A → B | [排查记录与本地回归](D6-2026-11-22-a-identity-fallback-investigation.md) | A 本地通过。B 修复版部署、真实生成、双账号隔离待验 |
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
