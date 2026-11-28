# 公开站 AI 剧本发布说明

评委打开站点，选择模板并点击「请求 AI 剧本」。浏览器自动建立轮次和密钥，Function 使用站点凭证与一个预先配置好的 Agent，在指定 Environment 中建立独立 Session。校验通过后页面显示「AI 剧本 · 预置上报」。超时或不可用时仍能开始预置训练，发送状态未知可查询原请求。

## B 发布

1. 在 **目标站的 Qoder 凭证有权使用的账号或工作区** 准备一个文本生成 Agent 和一个云 Environment。可复用既有可用资源，在资源详情或 Cloud Agents 列表中取得两个完整 ID。测试报告中的缩写不能用于配置。Agent 只需按用户提示返回 JSON，无需工具。每次访客请求只创建 Session。
2. 合入本次 Function 和前端改动后执行 `npm run build:sites:d6`。独立站静态根使用 `cloud-verify/dist/d6`，Function 目录使用 `cloud-verify/functions`。交付 ZIP 对应目录为 `static/`、`functions/`。若主站还要保留旧子入口，将静态页合入现有发布布局。沿用已有 D5 三张台账表及复合主键、Function 数据库读写权限和私有 Storage。
3. 在 Function 发布配置中声明并绑定下表值，重新发布至 public 站点。关闭旧单次实验和诊断模式（`D5_ENABLE_ANON_EXPERIMENT=0`，移除 `D5_ANON_AGENT_DIAGNOSTIC_ID`）。仅开放剧本时保持旧 `D5_ENABLE_QODER`、测试路由、上报和点评开关关闭。D6 云同步沿用原配置。

| 站点配置 | 值 |
| --- | --- |
| `D5_ENABLE_PUBLIC_SCENARIO` | `1` |
| `D5_ANON_EXPERIMENT_PUBLIC_ORIGIN` | 当前 public 站完整 HTTPS origin，沿用 FIX-v2 同源配置 |
| `QODER_PAT` | 由站点的 qoder 能力提供，仅服务端可见 |
| `QODER_AGENT_ID` / `QODER_ENVIRONMENT_ID` | 上述资源的完整 `agent_…` / `env_…` ID |
| `D5_PUBLIC_SCENARIO_LIMIT` | 本站 AI 剧本成功额度，整数 1～100。进行中或发送状态未知的请求暂占名额。首次公网验收填 `1` |

每次新请求在创建 Session 前预约一个整站名额。合法 AI 剧本通过校验并写入终态后计入成功额度。已持久化的终态回退归还本请求的预约，保留原轮次、槽位和结果。发送状态未知时保留预约，通过原请求 GET 只读恢复，确认终态后再结算。同一请求重放沿用原结果。额度用尽或配置不齐时，页面展示回退来源。

沿用 `d5_generation_results` 及其复合主键。旧版 `payload={}` 的预约缺少归属，部署新版后仍保守占额，需要用旧运行证据另行对账。页面会话的三次点击计数独立于整站成功额度，同一页面用尽后仍按现有规则停用按钮。

## 验收

用全新浏览器打开发布后的网页，选择模板并点击「请求 AI 剧本」一次。无需登录、开发者工具或实验轮次准备代码。核对合法剧本实际挂载、`selection=generated`、`provider=qoder`、`calls=1`，并按原轮次核对独立 GET。若上游已接收消息但页面超时，保留原请求并只读查询。关闭 `D5_ENABLE_PUBLIC_SCENARIO` 后重新发布可停止公开生成。

本地已用 Sites 路由替身验证匿名生成、并发最后一个名额、重复请求和错钥读回；Chrome 通过本地模拟提供方验证按钮到训练页。真实生成取决于目标站的发布版本、上述两项资源授权及其模型服务回执。[Qoder 创建 Session 接口](https://docs.qoder.cn/cloud-agents/sessions-create)
