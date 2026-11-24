# FIX-v2 · 2026-11-24 · Qoder Sites 托管后同源校验

执行人 A。本地工作区开工时干净，HEAD 和已缓存的 `origin/main` 为 `b58ae12`。本轮 GitHub 拉取连接被重置，通过连接器查找 B 公网凭证亦未取得文件。以下历史状态来自 B 的 2026-11-24 同源问题单，B 原 §B5 留由 B 追加。

## B 原公网回执

原测试站 `https://campus-drill-anon-test-kqvhf8qsvw2.qoder.zone`，实验 action `253fe21f…`。B 记录正确密钥的匿名 GET 返回业务 `404 missing`，正确密钥和固定错钥的同源 POST 都返回 `415 same_origin_required`。固定台账根 `d5-anonymous-experiment-v1` 的三张表为零，真实模型发送 0 次。这是 FIX-v1 的原回执。

## A 本地红绿验证

1. 先加入带真实请求形状的本地回归。请求 URL 用 `http://127.0.0.1:8787/app/api/d5/scenario`，Origin 用公网域名，并断言二者不同。基线运行 `npm run check:fix:v1` 退出 1，确认为 `HTTP 415 same_origin_required`。
2. 补丁只更新匿名实验分支的 Origin 比较值。合法 HTTPS 配置由 URL 解析归一化，其余情况回到请求 URL 的 origin。请求头仍精确匹配，跨站相关规则及授权、台账和模型发送路径均沿用原实现。配置名和值见 [B 复验操作单](../handoff-fix-v1.md#6-fix-v2-在原测试站复验)。
3. 使用同一 Sites 应用入口的本地替身，公网同源、正确密钥返回 `200 generated`，每个正例发送一条替身消息，同轮无 Origin GET 读回相同结果。公网错钥返回业务 `404 not_found`，外站、另一个 qoder.zone 子域、内部 origin、`cross-site`、`same-site` 和尝试借用转发头的请求均为 415。负例的三表和上游请求数均为零。大写域名、默认端口和末尾斜杠在配置端正确归一化。空缺或非法配置保持原逻辑。
4. `check:fix:v1`、`check:d7`、`build` 和 `build:sites:d6` 均退出 0，评分基准为 83／44／90／83。本轮 A 真实模型发送 0 次。日志含测试时间、新版 Function 文件校验和及完整退出状态。 [红绿回归日志](fix-v2-validation.log)

## B 待补公网结论

- **同源阻塞关闭：本地通过，公网待 B。** 记原 415 到新版同源错钥业务 404 的变化，补外源探针的实际观测、原轮只读 `404 missing` 和三表零写入。若平台先返回反爬拒绝，按实际回执注明。
- **公网匿名剧本生成：未执行。** 等原站发布并完成零发送预检后，由 B 用原匿名窗口点击一次。取上游受理或助手响应、合法候选挂载、`generated/qoder/calls=1` 与原 GET 一致，随后重新发布关闭版并核对台账。A 当前没有原站发布权限或本轮 B 浏览器回执。 [发布、零发送预检和关闭](../handoff-fix-v1.md#6-fix-v2-在原测试站复验)
