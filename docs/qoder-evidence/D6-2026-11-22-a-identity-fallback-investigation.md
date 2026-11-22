# D6 A 轨排查：B 站登录后回退与空用户分桶

## D6-v4 补记（2026-11-22）

开工 HEAD 为 `b251dc2`，本地 `origin/main` 为 `b924307`。保留已有 A 工作区改动，并保留 B 的发布入口与 `package.json` 描述。B 的 §8／§9 可用 `git show b924307:docs/qoder-evidence/D6-2026-11-21-b-cloud-publish.md` 查阅。§8 已关闭 B 的云同步首写问题，§9 记录了登录后两轮 AI 回退、零发送及空桶。首次失败的具体步骤仍缺同期上游日志。warm 耗时无法单独识别命中的绑定。

- 应用入口等待 `requireUser(ctx)`，兼容同步和 Promise 返回。D5 只采信平台结果根对象与 `user`、`identity` 容器的非空字符串标识。实际网关历史回执有 `user_id`，Function 内字段待修复版 diag 核对。空身份生成与 warm 返回 401，零写入、零上游调用；diag 可只读展示旧空桶并跳过 models 访问。
- warm 通过响应区分身份、Storage 和上游错误，附脱敏的失败步骤、已取得的 HTTP 状态和请求关联。scenario 保留预置回退契约，诊断进入 trace。持久化模型后，同键同请求体恢复 Agent。Managed Environment 使用创建前的持久登记与 metadata 只读回查，结果未知时不重发创建；有明确拒绝依据时才允许下一次尝试。恢复成功清除旧终态错误。[Agent 创建](https://docs.qoder.cn/cloud-agents/agents-create) · [Environment 创建](https://docs.qoder.cn/cloud-agents/environments-create) · [Environment 列表](https://docs.qoder.cn/cloud-agents/environments-list)
- 本地 `npm run check:d6`、`npm run build`、`npm run build:sites:d6` 通过，固定分数 83／44／90／83。实际 `index.ts` 接入本地平台替身，复核外层 401、同步与异步身份、空身份零写入零访问模型、同账号重复 warm 复用资源。应用入口的模拟生成得到 `generated/qoder/calls=1/complete`，第二个模拟身份读取相同请求返回 404，原身份仍可读取。真实模型发送 0 次。
- B 发布时一并合入 `cloud-verify/functions/routes.mjs`、`d5-routes.mjs` 和 `d5-service.mjs`。按新版 diag → warm → diag 确认身份与绑定，再按当前开关提交一次真实生成。跨账号验收用第二账号只读查询第一账号刚完成的轮次；只比较字段名或创建时间不足以证明隔离。
- 状态为 **A 本地回归通过**、**B 修复版部署未执行**、**B 真实生成未执行**、**B 双账号隔离未执行**。交付包 `D6-v4-A-local-fix.zip` 含基于 `b924307` 的补丁、Function 源码、校验和与日志。本次不提交、推送或改变站点状态。

2026-11-22。排查对象：B 公网站 `campus-drill-sandbox-kqvhf8qsvw2.qoder.zone`（site `01a1f8cc-becd-768a-8512-beef169dcc46`）。基线源码 `b251dc2` + 本轮工作区修改。本文不含令牌、Cookie、会话值、用户 ID、上游资源 ID、签名 URL 或请求头值；只记录字段名、类型、非空标志、公开静态资源哈希、请求关联 ID 与 HTTP 状态。

## 0. 结论摘要

1. **首次回退的精确失败步骤在当前 A 侧证据下无法证实**。B 的历史记录称首个 `GET /api/v1/cloud/models` 失败，但旧代码在任何 `ensureResources` 异常时都用 `{...claim, state:"unknown", model:null}` 覆盖绑定，`model:null` 不能证明失败发生在 models 步骤；Function 日志为空；A 仓库内 B 凭证副本只到 §7，无 §9。**本次复测 models 已健康**，无可复现的首次网络失败。
2. **后续回退可由“旧 `unknown` 绑定短路”解释**。旧代码读到 `state:"unknown"` 时在访问上游之前直接抛 `network`；本次 `GET /api/d5/diag` 的 models 成功与 `POST /api/d5/warm` 的 503 发生在同一秒，warm 耗时约 0.63s（一次 Storage 读的量级），与“尚未新建绑定”不符。该判断仍受“无法直接读取 B Storage”限制，但新 diag 会在 B 重部署后直接展示该绑定的状态与步骤且不修改它。
3. **空桶根因是 Function 侧身份为空，不是网关登录缺失**。网关 `/__qoder_auth/me` 返回的 `user_id` 非空且同账号两次调用稳定；旧代码 `digest(user.user_id)` 无任何校验，历史绑定哈希等于 `SHA-256("")`。A 侧已在路由层改为“解析平台提供字段 + 缺失即 401 失败关闭”，不再读写空哈希桶；Function 侧具体字段名需 B 重部署后由新 diag 确认。
4. **真实生成尚未复测**。本轮未发起真实发送，也未写入新业务数据；B 需先合并并重部署 Function，按 §7 的顺序复测。第二账号隔离因只有 1 个可用 Qoder 账号，**未验证**。

## 1. 部署与版本对照（只读实测）

| 时间 (UTC) | 探测 | 结果 |
| --- | --- | --- |
| 2026-11-22T06:18:35Z | `GET /functions/v1/app/api/d5/diag` | 200；`configured:true`、`model_count:13`、`selected_model:"fast"`；instance `e15979ba-…`；响应头请求 ID `b00e5ad2-…` |
| 2026-11-22T06:18:52Z | `POST /functions/v1/app/api/d5/warm` | 503 `ai_service_unavailable`；body request_id `d2230300-…`；响应头 `acf60b02-…` |
| 2026-11-22T06:23:12Z | `GET /__qoder_auth/me` ×2 | 200；字段 `host_id/name/picture/session_expires_at/site_id/user_id` 均非空；`user_id` 两次哈希相同 |
| 2026-11-22T06:23:12Z | `GET diag` / `GET instance` | diag 200（13 个模型，`fast`）；instance 200；request_id `3f56def3-…`；instance `8c123d4e-…` |
| 2026-11-22T06:23:18Z | `POST warm` | 503 `ai_service_unavailable`；body request_id `72dd0902-…`；响应头 `3448bc30-…` |
| 2026-11-22T06:23:28Z | `diag` → `warm` → `warm` | diag 200 / 638ms；warm 503 / 633ms；warm 503 / 646ms；请求 ID `c84debc3-…`、`36d709c8-…`、`e913a39f-…` |

静态资源（匿名同源读取，2026-11-22T06:23:18Z）：

- `assets/index-CcZBMWCL.js` 320,053 B，SHA-256 `0c6fdf8049001b17ac84a5b905c1a91acea6497bb9367c75fb8b572435560721`，与 B 凭证 §3/§5 全等。
- `assets/index-DarJ0iUK.css` 88,552 B，SHA-256 `696bb85ea004db3eab2f26dce63def3dc255199097cc4b6d05fb4ac07a945b5c`，与 B 凭证 §3 全等。
- 根 `index.html` 57,556 B，SHA-256 `ce3909ae…`；与本地发布包不同，原因是平台注入水印脚本（B 凭证 §5 已记录该平台行为），不作为版本不一致证据。

Function 代码无法从外部计算字节哈希。**版本标记**：上述 live diag 响应只有 `configured/ledger/instance/model_count/selected_model/models/real_generation_enabled`，没有本轮新增的 `identity` 与 `binding` 字段，说明 B 当前运行的 Function 仍是修复前版本。重部署后 diag 必须出现这两个字段，才算新代码生效。`instance` 是每个 isolate 随机生成的值（06:18 与 06:23 不同），不是部署版本号。

## 2. 首次回退：能确定到什么程度

- **能确定**：当前部署下 models 调用成功，且在同一时段 warm 失败；因此“登录后立即回退”的现状不是 PAT 缺失、域名错误或网关登录缺失。
- **不能确定**：历史第一次失败到底发生在 models、Agent 创建、环境创建还是响应形状校验。原因：
  - 旧 `ensureResources` 的 catch 用 `claim` 覆盖绑定，丢失 `model/agent_id/environment_id` 进度；`model:null` 只说明“claim 中 model 一直为空”，不能定位步骤。
  - Function output 日志为空；A 仓库的 B 凭证副本无 §9；B 附件中的“`/models` network 失败”是待验证假设。
- **新增证据能力**：修复后每个步骤记录 `status`、`stage`（`transport/http/parse/shape/validation`）、`http_status`、`request_id`，并保留已成功的 `model/agent/environment` 进度。下一次失败可直接从 `diag.binding.steps` 与 `failed_step` 定位，不再依赖猜测。

## 3. 后续回退与旧绑定

旧代码路径（已核实于 `cloud-verify/functions/d5-service.mjs` 基线）：

```js
if (binding?.state === 'unknown') throw new ProviderError('network', false);
```

该分支在任何上游调用之前执行。因此只要命中旧 `unknown` 绑定，就必然 `calls=0`、`upstream_state=not_sent`、`fallback_reason=network`。

本次只读证据：

- diag 在同一秒内成功拉取 13 个模型，说明上游与 PAT 可用；warm 仍 503，且两次 warm 都在 0.63s 左右，符合“Storage 读一次后短路”，不符合“新建绑定（读+写+models+Agent+环境）”的耗时。
- 未直接读取 B Storage（A 账号不拥有 B 站点，Sites MCP 返回 `sites_request_failed`）。该判断是代码路径 + 请求时序 + B 历史绑定哈希的合并推断，不是直接读取产物。
- **旧绑定未被删除或覆盖**：本轮只调用 diag/warm；旧代码的 unknown 分支不会写；新 diag 的 `empty_identity_binding` 也只读。B 重部署后应保留该文件作为证据。

## 4. 空用户分桶：根因与修复

### 4.1 根因

- 网关会话正常：`/__qoder_auth/me` 200，`user_id` 非空；同账号连续两次调用 `user_id` 哈希一致。
- Function 侧旧代码直接 `digest(user.user_id)`，无空值/字段校验；历史绑定路径哈希为 `SHA-256("")`，说明传入的是空字符串。
- 因此问题在 **Function 上下文的身份注入/字段映射**，不在浏览器会话，也不在网关 `/me`。旧代码把所有空身份请求合并到同一桶，造成预算与资源绑定共享。

### 4.2 A 侧最小修复（本轮工作区）

文件：`cloud-verify/functions/d5-routes.mjs`

- 新增 `IDENTITY_FIELDS = ['user_id','userId','uid','sub']`，只读取 `requireUser()` 返回对象（含其 `user` / `identity` 容器）中的平台字段；浏览器提交的 `user_id` 不参与。
- `resolveIdentity(user)` 取第一个非空字符串；`describeIdentity(user)` 只输出字段名、类型、是否非空，不输出值。
- 所有需要账本/绑定的 D5 路由在 `digest` 之前执行 `requireIdentity`：
  - 无用户对象 → 401 `identity_required`
  - 有用户对象但无可信非空字段 → 401 `identity_unavailable`
- `diag` 与 `instance` 保持可用：diag 返回 `identity.resolved`（字段名或 null）、`identity.fields`、当前桶 `binding`、空哈希旧桶 `empty_identity_binding`，便于 B 在重部署后直接判断“身份字段是否注入”与“旧桶是否仍存在”。
- 游客预置流程不变：预置剧本在客户端使用；D5 生成路由仍要求登录，不新增自建账号体系。

### 4.3 身份验证状态

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 网关同账号稳定 | 已验证 | 同账号 `/me` 两次调用，`user_id` 哈希相同 |
| Function 侧同账号稳定 | 待 B 重部署后验证 | 重部署后同一账号连续两次 diag，`identity.resolved.field` 应相同；`warm` 后 `binding.created_at` 应不变 |
| 第二账号隔离 | **未验证** | 当前浏览器只有 1 个可用 Qoder 账号；需第二账号按 §7 复测，或明确标记未验证 |
| 真实生成 | **未验证** | 本轮 0 次真实发送；需 B 重部署且 diag 解析到非空字段后，用新 `run_id` 做 1 次 |

若 B 重部署后 diag 的 `identity.resolved` 仍为 `null`，A 的字段候选未命中，说明平台没有向该公开站 Function 注入任何可信用户标识；这不是前端重新登录能解决的，需平台侧排查身份注入，或把真实生成入口放到仅登录/受邀访问的站点。此时 401 失败关闭比继续写空桶更安全，但 AI 生成仍不可用。

## 5. `ensureResources` 诊断与恢复（A 轨）

文件：`cloud-verify/functions/d5-service.mjs`

- 步骤记录包括 `binding_read`、`binding_write`、`models`、`agent`、`environment`。状态有 `ok/error/reused/recovered`，日志在实际可得时保留 HTTP 状态与受限格式的请求 ID。
- 上游错误分类：
  - 请求未取得响应：`stage:"transport"`（无 HTTP 状态）
  - HTTP 非成功：`stage:"http"` + `http_status` + 响应 `x-request-id`/`x-qoder-request-id`（仅接受受限字符集）
  - 响应解析失败：`stage:"parse"` + HTTP 状态 + 请求 ID
  - 响应形状非法：`stage:"shape"` + 200
- 失败写回不再用 `claim` 覆盖：保留已成功的 `model/agent_id/agent_version/environment_id`，记录 `failed_step`。
- `unknown` 绑定可恢复：已确认的 Agent 和 Environment 直接复用，缺 Agent 时复用已登记的模型、请求体与幂等键。Environment 未确认时按持久登记查找原资源，只有唯一匹配才恢复 ready。缺少旧创建关联、只读查无结果或结果不唯一时报告 `reconciliation_required`，保持现有绑定证据。
- `Storage` 写失败映射为 503 `backend_storage_unavailable`，与上游 AI 故障区分；生成路径内部仍回退 `network`，不改变既有 `selection/fallback_reason/calls/upstream_state` 契约。
- 旧 `unknown` 空桶文件不在任何新身份桶的恢复路径上；B 重部署后即使解析到新字段，也只会创建/恢复新桶。

## 6. 本地验证

命令与结果：

- `npm run check:d5`：通过（含 D1–D5 固定评分 83/44/90/83 不变、D5 cloud port、台账与 Sites route mock）。
- `npm run check:d6`：通过（含 D6 空库首写、生成 bundle 往返、事件部分写入、端点契约）。
- `npm run build`：通过（`vue-tsc` + Vite）。
- `npm run build:sites:d6`：通过（`cloud-verify/dist/d6` 重建，`d6-shared.mjs` 未产生差异）。
- 新增 `scripts/verify-d5-identity.mjs`：覆盖
  - 空 `user_id` 不解析、`userId` 回退、嵌套 `user.user_id`、`id` 不被误用
  - diag 字段描述不泄露字段值
  - 新绑定 models→Agent→Environment 全步骤
  - ready 同修订零上游调用/零写入
  - 旧修订旋转 Agent
  - unknown 复用 Agent 只补 Environment
  - Environment 失败保留 Agent/model 并记录 503 + 请求 ID
  - models 失败定位到 `failed_step:"models"` 且记录 502 + 请求 ID
  - 绑定诊断不输出 Agent/Environment 原始 ID
  - 缺失绑定返回 `{readable:true, exists:false}`，Storage 不可读返回 `{readable:false, exists:null}`
- 额外本地路由级冒烟（未入库）：空身份 diag 200 且 `resolved:null`；空身份 warm 401 `identity_unavailable`；`userId` 身份 diag/warm 200，绑定写入 64 位哈希路径。

冻结契约、fixtures、数据库 schema、评分与规则沿用原实现。Function 交付包含入口路由、D5 路由与提供方，测试已归入 `check:d5`，由 `check:d6` 执行。

## 7. 给 B 的复测步骤（按顺序）

在 B 的集成版本应用 `D6-v4-A-local-fix.patch`，先运行 `git apply --check`，再运行 `npm run check:d6`、`npm run build:sites:d6`。沿用 B 的静态根布局、Function 权限和既有开关，发布 Function 时同步 `routes.mjs`、`d5-routes.mjs` 和 `d5-service.mjs`。在部署回执中记录 action、deployment ID 和 Function 文件校验和，以实际同源响应确认代码生效。

以下路径相对于 `/functions/v1/app/api/d5`。逐步记录通过、失败或未执行。

1. **版本与身份**。同源登录后执行 `GET /diag`，确认 `identity`、`binding` 和 `empty_identity_binding` 均存在。已有当前用户绑定也是正常结果。网关 401 时恢复同站登录；`identity.resolved=null` 时停住 warm 和生成，提供脱敏字段结构、关联 ID 和只读旧桶状态给 A／平台。
2. **资源就绪**。身份已解析且 `binding.readable=true` 时，`POST /warm` 一次后 `GET /diag`，核对 warm 200，绑定 `ready` 且含 Agent、Environment。Storage 不可读或者失败返回 `reconciliation_required` 时留存 `failed_step/steps`、可得的 HTTP 状态和关联 ID。
3. **同账号复用**。同账号重新登录后再 warm，比较绑定和 Agent、Environment 指纹，证据中只留比较结果。`created_at` 用作辅助信息。
4. **一次真实生成**。已有授权时用新的合法 `run_id` 和 `request_id` 从页面单击一次，沿用每轮四槽、15 秒预算。超时后按原请求查询。验收同时要求 `selection=generated`、`provider=qoder`、`calls≥1`、台账 `sent/complete`、导出复算一致，并记录实际采用的上报来源。已 ready 但仍回退时，沿 trace 核对 Session、发送、模型回复和候选校验。
5. **跨账号隔离**。第二个真实账号 GET 第一账号刚完成的同一个 `run_id`、`request_id`、模板和修饰项，应无法读回该结果。切回第一账号应仍可读取。缺第二账号记录为未执行。

B 页面按错误码展示「登录或站点身份未就绪」（401 `identity_required/identity_unavailable`）、「站点存储不可用」（503 `backend_storage_unavailable`）和「AI 服务暂不可用」（503 `ai_service_unavailable`，或 `ai_not_configured`）。游客仍可选预置训练。只有 B 修复版真实生成证据闭合后才关闭登录后生成回退问题。

## 8. 未决与风险

- Function 侧可信标识的**确切字段名**仍未在 A 侧实测：平台模块 `_qoder/backend.mjs` 不在仓库、发布 `runtime/app.zip` 不含该模块、客户端 `app.asar` 未命中相关实现。新 diag 是 B 重部署后的实测入口。
- 首次失败的**精确上游状态码**仍未知；新 steps 会在下次失败时记录。
- 真实生成与第二账号隔离**未验证**，需 B 重部署后按 §7 执行；任何真实发送仍需用户授权并只做首发 1 次。
- 若 B 重部署后 `identity.resolved` 仍为空，真实生成在本期无法恢复；应保留登录门槛与预置回退，并把平台身份注入作为阻塞项升级，而不是放开匿名生成破坏预算隔离。
