# D6 B 轨云同步后端配置与公网发布

2026-11-21。B 公开站 `01a1f8cc-becd-768a-8512-beef169dcc46`（project `01a1f8cc-bec9-788f-b4dc-3093e3d14be4`，host `campus-drill-sandbox-kqvhf8qsvw2.qoder.zone`，public）。基线源码 HEAD `e504106` + 工作区 B 侧集成（文件哈希见 [本机集成验收](D6-2026-11-21-b-integration.md)）。本文不含令牌、Cookie、签名 URL、访问密钥或请求头值。

## 1. 后端分配（已授权：用户「完成云同步和公网同步，对接A的后端」）

- 分配前 `get_site`：backend `disabled`、无 Function、无数据库；站点 public、active。
- `ensure_backend`（request `37bf5d26-69e4-461f-8914-b21e36756539`，capabilities `database/functions/storage`，`databaseAccessModel=function_backend`）→ operation `01a1fe4a-edef-7452-acad-c5f391cc4710` **succeeded**（provision_backend + initialize_database）。
- Storage 一并绑定：通用 Function 入口 `index.ts` 导入 `_qoder/storage.mjs`（D2/D5 历史兼容路径需要）。

## 2. 数据库迁移（按 db/README.md 顺序 D2→D5→D6）

**平台限制实测**：迁移校验器拒绝大写类型名（`TEXT/INTEGER/JSONB/TIMESTAMPTZ`），报 `unsupported_ddl`；小写类型通过。与 A 站历史迁移名 `d2-probe-buildings-lower-20261118` 的「lower」一致。仓库 `db/migrations/*.sql` 为大写类型，提交时逐字转小写，结构、默认值、外键、索引、UNIQUE 均不变。两个未应用的探针计划（`d2-probe-min-2026-11-21`、`d2-probe-textpk-2026-11-21`，app.entries）仅用于定位校验器行为，**未应用、不在结构中**。

| 步骤 | clientMigrationId | migrationId | apply operation | 终态 |
| --- | --- | --- | --- | --- |
| D2 楼栋表先行 | `d2-buildings-lower-2026-11-21` | `01a1fe4f-730d-7a0e-a439-5fc15f66697f` | `01a1fe4f-aedc-7896-9a67-514d07fc31f9` | succeeded |
| D2 其余七表+六索引 | `d2-campus-app-2026-11-21-v3` | `01a1fe50-5d2a-77b2-92d7-c2681e68bccf` | `01a1fe50-7ce1-727c-b9dc-c8d3f28c61fb` | succeeded |
| D5 台账三表 + D1 探针表 | `d5-ledger-baseline-2026-11-21-v1` | `01a1fe51-0584-7a87-93f8-6011ad5917e9` | `01a1fe51-272e-730b-abec-c6db9facc0f5` | succeeded |
| D6 八列增量 | `d6-run-persistence-2026-11-21-v1` | `01a1fe51-9d2b-77e6-ab99-7585e3e56207` | `01a1fe51-c002-7678-80d2-aeec1b5f1bea` | succeeded |

- D1 探针表 `d1_connectivity_check` 为 B 侧新增（A 站历史保留表，供 `/api/d1/db` 诊断 parity），结构按 routes.mjs 的 insert/select 字段。
- 全部 `accessPolicies: []`（function_backend 模型，平台自动授予 authenticated function_backend 模板，匿名无直接表权限；业务访问只经 Function + X-Run-Key）。
- 迁移后结构（`get_database_schema`，observed `2026-11-21T13:36:28Z`，stale=false）：12 表；`runs` 20 列（含 d6_revision/d6_progress_json/d6_origin_json/d6_owner_hash/d6_created_at/d6_updated_at/d6_event_seq）、`scenarios` 13 列（含 d6_bundle_json）。
- 未写入任何业务数据（迁移纯 DDL；预置模板数据由 Function 按需写入）。

## 3. 发布包组装

- `npm run build:sites:d6` 通过：`cloud-verify/dist/d6`（index.html + assets/index-CcZBMWCL.js + index-DarJ0iUK.css），构建 define 注入同源 `VITE_D6_RUN_PATH=/functions/v1/app/api/d6/runs`（bundle 内 grep 命中 1 处）。
- 发布目录 `cloud-verify/dist/b-publish/`：**D6 为根入口**；旧 D5 公开版按字节下载保留于 `/d5/`（发布前 live 根即 D5，匿名 curl 200；`/d2.html` 在 B 站历史上不存在，404 为原状）。
- SHA-256：
  - `index.html` `60f64f5259ae54075941683b0cce0f77a8025cf05e3533510ed744cc6de16099`
  - `assets/index-CcZBMWCL.js` `0c6fdf8049001b17ac84a5b905c1a91acea6497bb9367c75fb8b572435560721`
  - `assets/index-DarJ0iUK.css` `696bb85ea004db3eab2f26dce63def3dc255199097cc4b6d05fb4ac07a945b5c`
  - `d5/index.html` `e642e67a0060b3801fca83ba8f716c43a25d356152d5028dae6f62408143bb52`
  - `d5/assets/index-C7Qtm4oL.js` `e8e65c87b38b0920fc5cd734992ae392f9b7c52528ba46e53d7f292ffdcdc5fa`
  - `d5/assets/index-DPy1AsQC.css` `f795419058ed9743f0548ca1701513e76d6d9f97cced36f8c1f310c44b273273`

## 4. 草稿与开关

- `prepare_site` action `5440881a-c00f-4b8f-9250-2a90b1a4684c`：projectId 复用、webDirectory `cloud-verify/dist/b-publish`、functionDirectory `cloud-verify/functions`、`databaseAccess=read_write`、schemaRef 为迁移后终态、`secretNames=["D6_ENABLE_RUN_SYNC"]`、spa=true。verification operation `01a1fe53-3b77-7ed5-9580-a3cce2e77b0e` succeeded；artifactReady=true。
- 阻塞项：`sites_secret_not_ready`（D6_ENABLE_RUN_SYNC 缺值）。**开关值由管理员在站点设置录入 `1`**（MCP 无写值入口，值不进入对话/命令行）。`D5_ENABLE_QODER`、`D6_ENABLE_REPORTS`、`D5_ENABLE_TEST_ROUTES` 不声明不配置，按代码默认关闭；本轮真实模型发送 0 次。
- 待录入后：复查同步 → publish → 匿名实测（见 §5，待执行）。

## 5. 发布与匿名实测（2026-11-21 实测）

- 开关录入后复查：`dependenciesReady=true`、`canPublish=true`、blockers=[]；secret `D6_ENABLE_RUN_SYNC` sync_state=synced。
- `publish_site` → operation `01a1feb1-dd35-755f-affa-a2135e1f088d` **succeeded / committed**；`get_publish_status` **published=true**，readiness=publication_completed，url `https://campus-drill-sandbox-kqvhf8qsvw2.qoder.zone`。Function `app` edge / read_write / is_active=true。
- **静态字节核对（匿名 curl）**：根 `assets/index-CcZBMWCL.js`、`index-DarJ0iUK.css` 与本地发布包 SHA-256 全等；根 index.html = 本地 + 平台水印脚本注入（平台行为，非内容差异）。旧 D5 保留入口 **`/d5/index.html` 与本地 D5 字节全等**（`e642e67a…`）。注意：目录路径 `/d5/` 命中 SPA 回退返回 D6 根页，保留入口须用 `/d5/index.html`；`/d2.html` 在 B 站历史不存在（404 原状）。
- **匿名浏览器走查（headless Edge，全新 profile，无登录态）**：
  - 桌面 1440×900：开始预置训练 → 开始推演 → 首报 T+00:30 可见，`#run-save-status`「已保存到本机」。[桌面](assets/d6-b-public-desktop-sync.png)
  - 刷新恢复：同轮次 `ef9e5695…`、同节点 T+00:30，「已从本机恢复」，不自动播放。[恢复](assets/d6-b-public-restored.png)
  - 375×812：首报可见，`scrollWidth=375=innerWidth` 无横向溢出，「已保存到本机」。[移动](assets/d6-b-public-mobile-375.png)
- **云同步 API 匿名实测（tsx + 同源 Origin/Referer 头）**：
  - 无同源头的 PUT 被网关 403 拒（same-origin 校验）；带同源头后进入业务层。
  - GET 缺失/错误 64 位密钥 → 404 `NOT_FOUND`；无密钥 PUT → 404。**通过**。
  - **首次 PUT → 503 `CLOUD_UNAVAILABLE`（阻塞，见 §6）**；浏览器端点「同步云端」诚实显示「云端未同步，可重试 · 本机记录已保留」，本机进度不受影响。
  - 幂等/旧修订 409/读回全等等正例**待基础数据播种后补测**。
- 控制台观察到 1 类 403 资源加载报错（关闭态下的后台探测请求，待定位具体路由），核心训练/恢复/导出流程不受影响；不宣称 0 报错。
- 本轮真实模型发送 **0 次**（三个生成/测试开关未配置）。

## 6. 阻塞：云同步首写缺 D2 基础数据 + owner 插入工具失败

- **根因**：B 站为全新数据库，`campus_buildings` 等 D2 基础表为空。`server/run-repository.ts` 的 `ensureTemplate` 插入 `disaster_templates.start_building_id` 外键指向 `campus_buildings(id)`，空表导致 FK 失败 → `database_write_failed` → 路由 catch 返回 503 `CLOUD_UNAVAILABLE`（run-route.ts:56）。A 站当年已播种 D2 地图数据故无此问题；db/README.md 明确新环境需先备 D2 基础数据。
- **播种受阻**：owner 数据工具 `insert_database_rows` 对本站连续返回 `sites_request_failed`（已试 action_catalog 全量/单行、d1_connectivity_check 中文/纯 ASCII、campus_buildings 20 行，含/不含 schemaRef 均失败）；同站 `query_database_rows`（读）与迁移（DDL）正常。判定为平台管理写路径故障，非载荷问题，停止反复探针。
- **待办（需平台恢复或管理员替代路径）**：播种 `campus_buildings` 20 行 + `road_segments` 28 行 + `action_catalog` 6 行（载荷已按 fixtures/campus-map.json 与 canonical-run.json 生成，is_training=1）；`disaster_templates` 由 Function 首写自播种。播种后重跑 §5 云同步正例（首写 200/读回全等/幂等/409）。
- 本机保存版不受此阻塞影响，公网根入口可正常训练、刷新恢复、导出与独立核验。
- **2026-11-21 二次重试**：用户授权后再试 `insert_database_rows`（campus_buildings 单行 N7 request `dc9206e2…`、action_catalog 单行 A1 request `36ef6e82…`）仍均 `sites_request_failed`。读路径正常。按用户指示停止探针，转议替代途径。

## 7. 给 A 的根治请求：保存路径自播种起始楼栋（用户已选定此途径）

**现象**：全新 Sites 数据库（无 D2 基础数据）首次 PUT `/api/d6/runs` 返回 503 `CLOUD_UNAVAILABLE`；A 站因历史已播种 D2 地图数据而不复现。

**根因（代码锚点）**：`server/run-repository.ts`
- `ensureTemplate`（:111-126）插入 `disaster_templates`，其 `start_building_id` 外键指向 `app.campus_buildings(id)`；
- `ensureScenario`（:128-136）的 `scenarioRow` 同样含 `start_building_id` 外键。
- 空 `campus_buildings` → FK 23503 → `insert` 抛 `database_write_failed` → `server/run-route.ts:56` catch 归一为 503。
- 即保存路径**自播种模板与场景，却假设楼栋基础数据已存在**；新站首写必然失败。

**建议修法（A 逻辑层，B 不代改）**：在 `ensureTemplate` 之前增加幂等的 `ensureStartBuilding(frozen)`——从轮次快照自带的 `frozen.map.buildings` 取 `scenario.start_building_id` 对应楼栋记录，select 存在则 no-op，缺失则 insert（`is_training=1`，字段按 campus-map.json 结构：id/name/zone/category/floors/capacity/risk_tag/polygon_json/adjacency_json），23505 竞态按 ensureTemplate 同款回读处理。FK 顺序：楼栋 → 模板 → 场景。**最小修复只需起始楼栋**（FK 目标）；是否顺带播种全图由 A 定。数据取自冻结快照，不硬编码。

**约束**：A 站既有楼栋已存在 → select 命中 → 行为零变化；不改动冻结契约与评分；`scripts/validate-d6.ts` 增一条「空库首写」用例（空 storage + 空 DB fake，首写 200、读回全等）。

**B 侧后续**：A 合并修复后，B 拉取 → `npm run build:sites:d6`（重 bundle `d6-shared.mjs`）→ 重新发布 B 站 Function → 无需任何手工播种即可云同步；随后 B 补跑 §5 云同步正例（首写 200/读回全等/幂等 200/旧修订 409/错密钥 404）。A 站不受影响。

**期间状态**：B 公网根入口为本机保存版，训练/刷新恢复/导出/独立核验均匿名实测通过；云同步写入待此修复。