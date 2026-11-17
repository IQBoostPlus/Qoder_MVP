# D1（2026-11-17）· 引擎契约与基准数据对齐 v4.1 真实校区

| 项 | 内容 |
| --- | --- |
| 责任人 | A（引擎轨） |
| 轨道 | 契约、fixture、校验器、DDL、交接文档 |
| 关联 | F1/F6 地图与路径、F4/F5 上报、F8/F9 评分与复盘；D0 的 v4.1 规格 |
| 状态 | 已完成（本地 + Cloud Agent 连通）；详见 [`d1-cloud-verification.md`](d1-cloud-verification.md) |

## 1. 想完成什么

用户更新了真实校区建筑调研（[`docs/njit-campus-buildings.md`](../njit-campus-buildings.md)）与 v4.1 规格，要求把 D1 已生成的虚构建筑样例整体换成真实数据，并修正三处契约矛盾：

1. 楼栋改为 `N7/N1/N2/N11/CN1/CN2/GYM/LIB`，新增 `GATE3` 与 8 条路段；
2. `Building` 增加 `zone`、`floors`，新增 `Junction`；
3. U9 的 `building_id` 改为 N7，阻断路段 `R-N7E` 由 t=140 disaster 事件单独引用；
4. 所有操作 `t_sim` 落在剧本节点，补 220、250 推进回合；
5. A4 前置 A3 保留，两分支成功动作由 A4 换为 A3，甲补做 A4 得 90，乙在 250 提交 A3 于 280 完成。

## 2. 在 Qoder 中做了什么

- 读取 v4.1 需求/质量文档、调研文档与 D0 记录，按 §7.4 重建 fixture，而不是沿用旧 B1–B8。
- 更新 [`src/contracts.ts`](../../src/contracts.ts)：`Building.zone/floors`、`Junction`、`RoadSegment.from/to` 支持路口、`EventTruth` 删除 `road_id`、`CanonicalFixture.junctions`。
- 重写 [`fixtures/canonical-run.json`](../../fixtures/canonical-run.json)：8 楼栋 + 1 路口 + 8 路段 + 14 节点 + 10 上报 + 3 流水；甲 83、乙 44、甲补 A4 90。
- 新增 [`fixtures/buildings.json`](../../fixtures/buildings.json) 作为地图数据投影，校验器与 canonical-run 逐字段比对，防止两份数据漂移。
- 重写 [`fixtures/canonical-run.md`](../../fixtures/canonical-run.md) 与 [`docs/handoff-d1.md`](../handoff-d1.md)，移除 B7 / R-East / 7 号楼 / 东门等旧标识。
- 更新 [`scripts/validate-canonical.ts`](../../scripts/validate-canonical.ts)：楼栋/路口/路段引用、连通性、U9 路段事件、A4 前置正反例、SC-03/03b/04/05/07/08。
- 更新 [`db/schema.sql`](../../db/schema.sql)：增加 `zone`、`floors`；路段端点改为 `from_node_id` / `to_node_id`，允许路口。保持八表基线，Junction 不单列第九表。
- 合并 v4.1 README，保留 D1 本地与云端状态。

## 3. 如何验证

### 3.1 类型检查与 fixture 复算

```text
$ npm run check:d1
> tsc --noEmit
> tsx scripts/validate-canonical.ts
D1 canonical fixture validation PASSED
buildings=8 junctions=1 roads=8 reports=10 actions=6 runs=3
run-jia-1x [甲] 甄别=80 响应=100 命中=80 违规=70 总分=83 | 响应 45s, 违规 2 次, 缺项 1
run-yi-1x [乙] 甄别=60 响应=0 命中=50 违规=55 总分=44 | 响应 250s, 违规 3 次, 缺项 4
run-jia-plus-a4 [甲补做A4] 甄别=80 响应=100 命中=100 违规=70 总分=90 | 响应 45s, 违规 2 次, 缺项 0
clock_checks: 1× = 45s, 4× = 45s (模拟时刻 30 → 75 固定)
quality cases: SC-03 / SC-03b / SC-04 / SC-05 / SC-07 / SC-08 通过
```

完整输出保存在 [`d1-local-validation.log`](d1-local-validation.log)。

### 3.2 八表 DDL 实际执行

用 Node 24 内置 `node:sqlite` 在内存库执行 `db/schema.sql`，并插入 8 楼栋、8 路段：

```text
tables 8
buildings 8 roads 8
zone { zone: '天健苑·西部', floors: null }
```

八表基线未被破坏；`GYM` 的 `floors = null` 按「大跨度通高」处理。

### 3.3 旧标识残留

排除历史对照（v2 `mvp-spec.md`、D0 记录、调研原文、README 的「相对前版变化」）后，源码、fixture 与交接文档中不再存在可执行的 `B7` / `R-East` / `B6` 标识。

## 4. 结论与后续

- 本地契约、fixture、DDL 已与 v4.1 真实校区规格一致；83/44/90 与手算表逐项匹配。
- `N7` 起始、`R-N7E` 阻断、U9 定位 N7、A3→A4 前置、220/250 推进回合均已落进机器数据。
- Cloud Agent 真实调用已通过（固定提示词返回 `D1_OK`）；同一检查重复调用返回 `internal_error`，D2 需复用已建资源并保留预置剧本、上报与得分摘要兜底，详见 [`d1-cloud-verification.md`](d1-cloud-verification.md)。
- 仍需 A、B 在 D1 上午确认三处矛盾处理方式；如需改动乙分支 A3 的 250 秒，必须重算 SC-08（会变成 46）。

## 5. 待补凭证

- [ ] Qoder 对话截图：要求按新建筑调研整体替换的那一轮
- [ ] `fixtures/canonical-run.md` §1 地图表或 `buildings.json` 渲染效果截图
- [ ] Cloud Agent 首次成功页面截图（首次结果文本已留存；补截重试返回 `internal_error`）
- [ ] GitHub 提交页截图（本次对齐 commit）
