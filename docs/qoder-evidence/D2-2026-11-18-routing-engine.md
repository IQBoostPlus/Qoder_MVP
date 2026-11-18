# D2 · 2026-11-18 · 完整训练路网与阻断后寻路

实际执行日期为 11/18，A 轨原排期为 11/19。记录由 Codex 在本地工作区生成，用于项目验证归档。

同日后续用户完成授权，D1 验证表再次在云端读写成功。D2 云端操作在用户要求停止使用额度后停止，受限 SQL 方言的修正仍在本地。见 [云端复验](D2-2026-11-18-cloud-recheck.md)。

## 目标与实现

按 `prompt/D2-v1.md` 接入 20 栋、3 门、28 路段，使用同一份路网计算最短路径并回放道路状态。新增 Dijkstra 纯函数、完整地图和应用入口，保留原八栋 fixture、D1 静态路径及静态评分回归。新增 `R-N1-GATE3` 是训练备用道路。原道路折线在 D2 投影内按需补节点接驳，保留原始点序。

基线为 `b9595a7`，进入任务时 `git status --short --branch` 输出 `## main...origin/main`，工作树干净。实施前运行 `npm run check:d1-v2` 和 `npm run build`，退出码均为 0。基线为 8 楼栋、1 校门、8 路段，83 / 44 / 90 分，甲 1×/4× 响应 45 秒，甲违规 [14,20]、乙 [9,14,15]，静态路径返回 null。基线 Vite 转换 47 个模块。

## 本地与页面验证

- `npm run check:d2`、`npm run typecheck`、`npm run typecheck:app`、`npm run build` 均通过。[完整命令和输出](d2-routing-validation.log)
- CD-01 校验 D1 子集、D2 精确楼栋集合、邻接、23 节点连通性及节点坐标一致。小图测试最短性、反向走边、等长确定性、同点、孤立与未知节点，以及无效输入。RE-06 命中四个预期时刻，双倍速结果一致。复制快照全封闭后不可达，恢复快照后重新可达。[实际 RouteResult JSON](d2-routing-validation.log)
- 使用本地 `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`，以 Playwright Core 启动独立 Chrome 157。进入「示例回放」，点选润园 7 幢，选 N7 → GATE3 并按整数秒设置滑块；校验 SVG 点列、路径路段 ID、图上长度和道路表的两类状态。1440×950 与 375×812 均实测 20 个 SVG 楼栋、点选、139/140/164/165 秒改道及无横向溢出。两尺寸另在「推演」验证查询可达。浏览器发现旧首屏自动请求缺失的 favicon，补充内置图标引用后复测无控制台警告、错误和未捕获异常。[浏览器完整输出](d2-browser-validation.log)
- 375px 地图显示全部楼栋和校门，楼栋全名亦可从清单和点选详情读取。D2 视图增加留白，容纳边缘校门标签。首次验收发现门诊部（CLI）的 null 层数显示为「通高」，交接收尾已修正。

| 截图 | 1440px | 375px |
| --- | --- | --- |
| t=139，直达 120.0 px | [路径](assets/d2-engine-1440-t139-route.png) | [路径](assets/d2-engine-375-t139-route.png) |
| t=140，积水即绕行 660.0 px | [路径](assets/d2-engine-1440-t140-route.png) | [路径](assets/d2-engine-375-t140-route.png) |
| t=165，继续绕行，积水与正式封闭并存 | [地图](assets/d2-engine-1440-t165-map.png) · [双状态](assets/d2-engine-1440-t165-dual-state.png) · [路径](assets/d2-engine-1440-t165-route.png) | [地图](assets/d2-engine-375-t165-map.png) · [双状态](assets/d2-engine-375-t165-dual-state.png) · [路径](assets/d2-engine-375-t165-route.png) |

## 数据库与 Agent

**本次实测。** 在本地 PostgreSQL 18.6（PGlite 0.5.16）应用候选 DDL，核对 `app` 下恰好八张业务表，并逐字段比较 `campus_buildings=20`、`road_segments=28` 的写入与读回。独立加载 d2-1 的三座校门，读回路段引用均可解析，检查约束通过。附件含复跑命令、完整输出与数据库映射。[本地数据库日志](d2-local-db-validation.log) · [迁移与映射](../../db/README.md)

**历史结果。** D1 私有站仅验证了 `app.d1_connectivity_check`、`timestamptz`、Function 往返及一次固定提示的 `D1_OK`。第二次端点调用返回 `internal_error`，缺上游错误码，根因未确认。[D1 云端记录](d1-cloud-verification.md)

**云端受阻。** 站点根路径未登录时返回 `401 sites_gateway_login_required`。Edge 使用当前 Qoder 账户到达私有站授权页，页面要求向站点提供账号身份及基本资料。当前也没有可用的 Qoder Sites 数据库管理接口或有权的 Cloud Agent API 会话。云端迁移、读回、冻结、Agent 重复调用和公网匿名入口均待验证。恢复访问后第一步在 Qoder 站点工具调用 `get_database_schema` 核对目标结构，然后走迁移校验与写入读回。无凭证或授权页会话参数进入归档。

**Agent 接入核对。** 当前本地 D1 验证源码 `cloud-verify/functions/routes.mjs` 仍在单次请求内调用模型列表、资源创建、发送和轮询。`cloud-agents.mjs` 提供 `ensureCloudResources`，依赖应用提供带锁的持久化协调器，D1 路由尚未接入。D2 预置剧本和上报继续可用。恢复访问后按以下顺序接入并验证：

1. 先只读核对已有 Agent ID、版本、Environment ID 及已知 Session。已知会话下一条检查为 `GET /api/v1/cloud/sessions/{session_id}/events?order=desc&limit=20`，使用站点运行时授权。[Qoder 查询会话事件文档](https://docs.qoder.com/cloud-agents/api/sessions/events/list)
2. 使用服务端私有持久化存储 Agent 与 Environment 绑定，以部署配置版本复用。Session 按站点用户、轮次和逻辑任务隔离，并在消息发送前持久化 Session ID。相同逻辑请求复用绑定，以请求 ID 原子记录预算扣减和发送状态。验证两个不同轮次的 Session 隔离。
3. 发消息前保存事件游标或已知事件 ID。请求超时后，从该游标读取 Session 历史并核对发送是否被接受、答复是否生成。仅在确认原请求结束且未接受、仍有预算时重发。每轮最多发出 4 次模型请求，调用失败或超时按原约定展示预置数据或摘要。[Qoder 发送会话事件文档](https://docs.qoder.com/cloud-agents/api/sessions/events/send)

后续 D3 对齐 B 的 `ActionJudge`，实现真实动作规则和 A5 更新；D4 实测临场改分；D5 独立验收匿名公网访问。见 [B 轨交接](../handoff-d2.md)。

## 交接收尾

2026-11-18 复跑 `npm run check:d2` 与 `npm run build`，均通过。层数回归检查确认 CLI 与 GYM 保持 `floors=null`，按当前训练数据的类别口径分别显示「未公开」和「通高」。D2 地图文件与已归档的云端结构快照的 SHA-256 均与验收记录一致。

使用 Chrome 打开本地生产构建，通过楼栋清单逐一选中门诊部、体育中心和北 7，核对地图文字、无障碍标签、清单和详情。

```text
1440px 推演 地图标签/无障碍描述/清单/详情：门诊部=未公开，体育中心=通高，北7=5 层
1440px 示例回放 地图标签/无障碍描述/清单/详情：门诊部=未公开，体育中心=通高，北7=5 层
375px 推演 地图标签/无障碍描述/清单/详情：门诊部=未公开，体育中心=通高，北7=5 层
375px 示例回放 地图标签/无障碍描述/清单/详情：门诊部=未公开，体育中心=通高，北7=5 层
D2 层数展示浏览器复核通过，未捕获异常 0
```

复核确认寻路显示图上 px，B 端动作预计完成时刻由提交时的 `t_sim + duration_sim` 得出。私有站验收状态沿用云端记录，Agent 预算表述为计数观测 2/4，严格上限待验。
