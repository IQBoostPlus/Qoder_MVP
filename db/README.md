# D2 数据库核对

截至 2026-11-18，八表迁移及地图往返已通过本地 PostgreSQL 与 Qoder Sites 私有云端验证。云端的结构冻结、D1 表保留、20 栋 / 28 路段逐字段读回见 [云端验收](../docs/qoder-evidence/D2-2026-11-18-cloud-acceptance.md)。并发多实例下的预算原子性仍未验证，缺口记录在同一验收文档。

## 方言与迁移

- `schema.sql` 是 D1 SQLite 基线。正式站使用 [D2 候选迁移](migrations/d2-campus-app.sql)，目标为 Sites 提供的 PostgreSQL `app` schema。候选文件建八张业务表，适用于尚未建业务表的站点。上线前先回读实际表结构；已有同名表时按差异生成增量 DDL。
- [D1 私有站历史验证](../docs/qoder-evidence/d1-cloud-verification.md)确认了 `app`、`timestamptz`、主键、索引和 Function 内读写。管理端插入曾需要显式提供时间戳，Function 已验证默认值。11/18 云端复验前按 Qoder Sites 的受限 PostgreSQL 方言调整候选文件，时间戳用 `now()`，可含小数的业务字段用 `jsonb` 数值。SQLite 初版的 `CHECK` 与级联删除由应用层处理。读写应用保留值域与枚举校验，并在删除轮次时显式处理子记录。
- 核对顺序为 `get_site` 和 `get_database_schema`，然后用站点的迁移工具创建候选并验证。校验通过后在授权的私有环境应用，回读八表的列、约束和索引。按依赖先写楼栋再写路段，回读并逐字段比较。该流程已于 2026-11-18 在私有云端完成：两次迁移 apply 均 `succeeded`，八表结构与候选迁移无差异，20 栋 / 28 路段 452 项字段检查 0 diff。结构快照冻结于 `2026-11-18T10:35:18.492359Z`；后续结构变更按差异生成增量 DDL，不重建现有表。

## JSON 映射

| 对象 | 入库与读回 |
| --- | --- |
| 楼栋 | `polygon`、`adjacency` 对应 `polygon_json`、`adjacency_json`；保留 JSON 数组顺序和 `floors=null`。 |
| 路段 | `from/to` 对应 `from_node_id/to_node_id`；`geometry` 对应 `geometry_json`，保持点序；`blocked` 布尔值与 DB 0/1 互转；`hazard`、`block_reason` 独立保留可空值。 |
| 校门 | 读取随应用发布的 [campus-map.json](../fixtures/campus-map.json)（`schema_version=d2-1`）中的 `junctions`。配对相同地图版本的楼栋和路段，加载器按完整节点 ID 校验引用，再从路段端点派生位置。种子包与应用发布记录一起标记版本；当前八表只服务同一活动地图版本。 |
| 剧本 | 场景事件 `ugc_appear/disaster_confirm/road_hazard` 存于 `scenarios.nodes_json`。剧本来源支持 `generated/fallback/canonical`。 |
| 动作与上报 | `target_kind`、`resource_id`、`resource_units` 为独立列，`preconditions` 存 `preconditions_json`。上报的 `event_truth`、`judgment_windows` 分别存各自的 JSON 列。 |
| 学员流水 | `runs.id` 对应 `run_id`，`run_events` 以 `(run_id, seq)` 为主键。仅存 `verdict/action/sort`，载荷进入 `payload_json`，读取时按 seq 排序。 |
| 得分 | 分项及总分可直接查询；`runs.score_json` 保留完整 `ScoreResult`、`details` 和可选 `sorting`。 |

写入 `jsonb` 时发送 JSON 值，使用 SQL 参数绑定时可序列化并显式转为 `jsonb`；从 SQLite 旧数据迁移时先解析 JSON 文本。带 `is_training` 的表统一写 1。站点管理端写入按实际接口需要显式提供 ISO 8601 时间戳。验证阶段只写入模拟数据。

`weight`、`duration_sim`、`t_end`、`playback_speed`、四项分数、`t_sim` 和 `appears_at_sim` 使用 JSON 数值标量。业务接口读写时校验有限数与原值域，并显式写入 `playback_speed`。实际流水按 `seq` 排序。

## 本地复验

```powershell
$d2tools = Join-Path ([IO.Path]::GetTempPath()) 'qoder-d2-verification'
npm install --prefix $d2tools --no-audit --no-fund @electric-sql/pglite@0.5.16
node scripts/validate-d2-db.mjs $d2tools
```

该脚本在内存 PostgreSQL 中执行候选迁移，写入 20 条 `campus_buildings` 和 28 条 `road_segments`，比对所有地图字段及训练标记和时间戳，验证三座校门名称可从静态地图恢复。输出见 [本地数据库验证](../docs/qoder-evidence/d2-local-db-validation.log)。

## 云端复验

私有站点已按同一迁移与映射完成云端复验。结构快照、迁移 / apply 操作 ID、冻结时间、校验和及 20 / 28 地图逐字段结果见 [D2 云端验收](../docs/qoder-evidence/D2-2026-11-18-cloud-acceptance.md)。该站点保持 private；D1 验证表保留，未重建或覆盖业务表。并发多实例的预算原子性仍为 pending。
