# D2 → B 轨交接

2026-11-18 完成 D2 本地寻路与页面验收，原排期为 11/19。云端状态见下文。

## 接口与数据

```ts
createEnginePort(fixture: CanonicalFixture, mapSource: MapSource): FixturePort
useFixturePort(): FixturePort
buildRouteQuery(map: MapView, snapshot: ReplaySnapshot | null, from: string, to: string, at: number): RouteQuery
FixturePort.getRoute(query: RouteQuery): RouteResult | null
```

示例回放、推演舱与诊断台继续通过 `useFixturePort()` 获取引擎。工厂使用 [D2 完整地图](../fixtures/campus-map.json) 的 20 栋、3 门、28 路段，复用标准剧本、流水、可见性和静态评分。地图与回放快照取同一份路网。保留独立的 `fixtures/buildings.json`、`fixtures/canonical-run.json` 与 `createFixturePort`，以便严格重跑 D1 八栋基线。

使用 `buildRouteQuery(port.map, port.replayTo(runId, { t_sim }), from, to, t_sim)` 传入完整道路快照。允许楼栋与校门起终点；快照的 ID 集合须与地图一致，`blocked` 和 `hazard` 分别传递。省略快照使用初始路网，`at_sim` 仅标记结果时刻。推演舱当前沿用所选标准流水的道路状态，学员提交的新动作仍在本地账本等待判定。

- `ready` 含起终点、时刻、节点及路段序列、折线和长度。引擎允许同点零长查询，返回单节点、空路段与空折线。界面沿用已存在的同点提示。
- `unreachable` 说明未知端点或道路无通路。无效几何、重复或缺失 ID、拼接点不一致等输入错误通过 `FixturePortError` 报告。
- `null` 表示尚未查询或使用 D1 静态入口。D2 引擎对有效输入返回路径结果。

## 真实改道样例

标准甲分支 N7 → GATE3 的结果：

| 时刻 | R-N7E 状态 | 实际路径 | 图上长度 |
| --- | --- | --- | ---: |
| 139 | 无灾情、未封闭 | N7 → GATE3，`R-N7E` | 120.0 px |
| 140、164 | 积水、未封闭 | N7 → N1 → GATE3，`R-N7-N1` / `R-N1-GATE3` | 660.0 px |
| 165 | 积水、已封闭 | N7 → N1 → GATE3，原绕行路线 | 660.0 px |

`npm run check:d2` 复跑原基线并断言确切路径、折线与长度。关闭 GATE3 全部入边时不可达，恢复快照后重新可达。两倍速在相同模拟时刻返回同一路径。CD-01 数据已验，CD-04 和 RE-06 已在 Chrome 1440px 与 375px 验证 20 栋渲染、点选、实际改道及两类道路状态。全封闭不可达经 CLI 验证，页面当前没有构造全封闭快照的操作；渲染分支仍可在诊断台检查。完整结果及截图见 [D2 实测](qoder-evidence/D2-2026-11-18-routing-engine.md)。

## 数据与规则选择

- 训练道路默认双向；`R-N1-GATE3` 是新增模拟备用道路。原八栋轮廓与已有道路折线保留，D2 在部分原路段首尾加楼栋接驳段，并重算直接楼栋邻接。拼接后的长度包含这些接驳段。道路与坐标采用训练设定。
- 已核对 A/B 接口使用的两个单位。寻路使用折线的图上长度（px）排序和展示，等长路径按路段 ID 序列字典序选择。积水、火情等任何 `hazard` 立即阻断，正式封闭单独展示。B 端动作预计完成时刻按提交时的 `t_sim + duration_sim` 计算，`duration_sim` 由动作目录按模拟秒提供。D1 静态得分仍为 83 / 44 / 90。
- 工程实训归 `laboratory`，门诊部与综合服务楼归 `other`。地图标签、楼栋清单和对象详情统一显示 CLI「未公开」、GYM「通高」，两者的 `floors` 均保留 `null`。ADM 为地上 5 层、另有地下 1 层，SAC 的 2 层是已知下界。两项补充说明见需求 §7.2，界面当前显示数值层数。
- 数据库采用八表方案，Junction 从同版本静态地图加载。上述实现口径已核对，B 轨正式签认待补。

## 云端与下一阶段

1. 八表迁移、结构冻结、20 栋 / 28 路段往返和私有验证 Function 发布已完成。站点保持 private，D1 验证表保留 3 行，未重建或删除业务表，未放宽访问权限；452 项字段检查 0 diff。见 [云端验收](qoder-evidence/D2-2026-11-18-cloud-acceptance.md)。
2. Agent 持久复用已在同一私有站实测。同任务刷新后恢复同一 Agent / Environment / Session，m1 / m2 均获最终回复，顺序重复提交与已完成请求 resume 幂等，新任务获得独立 Session。共 2 次模型请求、0 重试、0 错误码，计数观测为 2/4，平台配额未提供。真实断流后的 pending 恢复、第 5 次请求触发预置兜底、发出后失败计数和多实例并发原子预算仍待验。详见 [云端验收](qoder-evidence/D2-2026-11-18-cloud-acceptance.md)。
3. D3 与 B 对齐 `ActionJudge` 提案和六动作规则。优先接前置条件、资源占用、完成时刻及 A5 动作对正式封闭的更新，使学员自己的动作能驱动改道。D4 验证实时评分一正一反，D5 独立验证公网匿名入口。
