# D7 结算与复盘点评交接

基线 `e81b538`。A 已交付点评与回退的本地实现、共享预算和 B 的接入入口。D6 公网首写关闭见 [B 发布记录 §8](qoder-evidence/D6-2026-11-21-b-cloud-publish.md#8-2026-11-22-修复发布与公网首写活体确认云同步阻塞关闭)。D6-v4 的 B 修复版真实生成和真实双账号隔离保留原待验状态。

## 运行和接入

```powershell
npm run build:sites:d6
npm run check:d7
npm run build
$env:D5_SIMULATE='valid'
$env:D7_ENABLE_REVIEW='1'
$env:VITE_D7_REVIEW_PATH='/api/d7/review'
npm run dev
```

本机演示将已结算快照交给回环接口，按轮次密钥锁定。Node 点评只接本地模拟提供方。Sites 版通过 `build:sites:d6` 设置同源 `/functions/v1/app/api/d7/review`。在线点评要求平台登录、有效 `X-Run-Key`、已云同步的结算记录，以及 `D6_ENABLE_RUN_SYNC=1`、`D5_ENABLE_QODER=1`、`D7_ENABLE_REVIEW=1`。上报开关沿用 D6 配置。部署需同时发布 Function 源码和 B 集成后的静态页。

从「结束推演并查看评分」开始，评分、分项、时间线与 `buildReviewSummary` 的完整摘要先显示。已满足点评条件时异步请求，Sites 未同步时先提示同步。生成完成后，点「查看第 N 条」定位这轮时间线，刷新后只查询原轮点评。无动作、断网、未登录和预算耗尽时仍显示完整摘要。8 秒到达后保留摘要并只读查询原请求；旧轮响应丢弃，当前轮迟到点评可以在原请求上补入。

## 同源接口

POST `/api/d7/review?run_id=<学员轮次>`，请求头 `X-Run-Key` 与 D6 保存相同。Sites 只读取已保存快照。Node 本地模拟可在 POST 增加 `run`，其结构与 D6 导出一致。

```json
{"mode":"start","request_id":"review-request-0001"}
```

显式重试发送 `mode=retry` 和新的合法 `request_id`。GET `/api/d7/review?run_id=<学员轮次>&request_id=<原请求>` 只查询，省略 `request_id` 读该轮最新一次。外部 URL 带 `/functions/v1/app` 前缀。请求 ID 与轮次 ID 均为 12～80 位字母、数字、下划线或连字符。

```json
{"run_id":"learner-run-0001","request_id":"review-request-0001","status":"ready","source":"ai","items":[{"seq":1,"text":"本轮模拟中，第1条在 T+30 秒对「萃园 7 幢（北 7）」提交「上报核查」，在结算前完成，评分器计入首报响应。"}],"reason":null,"calls":2,"can_regenerate":true}
```

```json
{"run_id":"learner-run-0001","request_id":"review-request-0001","status":"pending","source":"summary","items":[],"reason":"timeout","calls":null,"can_regenerate":false}
```

`ready/pending/missing` 通常对应 200／202／404；8 秒前台截止用第二个形状表达，服务端可继续处于 `pending`。`source` 区分 `ai/simulated/summary`。`items[].seq` 只引用本轮动作。`reason` 区分未同步、关闭、未登录、超时、离线、越界文字、错引用、事实不符、预算或关联失败。`calls=null` 表示该次响应未核实计数。以 `can_regenerate` 驱动按钮，进行中显示「点评生成中」，达到四次或共享槽已用时提示预算用尽。核心入口还保留平台 401、跨源 403 和无效轮次密钥 404。

## 预算与事实边界

- 生成轮的学员 `run_id` 与 `origin.request.run_id` 可以不同。服务端核对原请求、完整剧本及采用的上报与账本结果，再用原生成根计数。不同学员尝试共用这个生成根时，已占用的点评槽仍保留，其他轮也读不到前一轮的点评。从旧 Storage 台账无法确认可靠共享预算时回到摘要。
- 无生成来源的轮次，以学员轮次推导稳定的预算根。Sites 按轮次访问凭证的服务端哈希归属该根，模型资源仍使用已登录账号的绑定。第一次使用 `review`，显式再生成使用共享 `retry`。每槽只允许一个请求占用，发出后即计数。结果未知只读原 Session，保持重试禁用。
- 模型收到动作、目标、时刻、规则结果和与动作相关的得失分原因。模型选择 1～3 条并选取经校验的事后措辞。校验同轮 ID、动作序号、整条候选句及指挥短语；任一条失败则全部回到现有摘要。当前支持候选句选择，保留引擎事实与分数，点评不写入轮次或导出。

B 上线后按真实站点回执补测真实点评、刷新、预算、桌面／移动控制台与两名同学的实际五步用时。当前没有 D7 公网发布或实发授权，A 的本地验收不替代 B 公网验收。[D7 验收记录](qoder-evidence/D7-2026-11-23-review-acceptance.md)
