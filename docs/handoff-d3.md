# D3 → B 轨交接

2026-11-18 完成 A 轨六动作规则、学员流水和推演接入。原排期为 11/20。

D3 代码、测试和凭证与 D4 一起交接。B 轨正式签认待补，复验步骤见 [D4 独立复验](handoff-d4.md#b-轨独立复验)。

## 接口与事件所有权

```ts
type ActionJudge = (input: ActionSubmissionInput) => ActionAttempt | null

interface ActionSubmissionInput {
  action_id: ActionId
  target_id: string
  submitted_at_sim: SimSeconds
  seq: number
  prior_events: readonly RunEvent[]
}

EnginePort.judgeAction(input: ActionSubmissionInput): ActionAttempt
EnginePort.snapshotRound(events: readonly RunEvent[], t: SimSeconds): RoundSnapshot
```

B 在当前可写节点提交 `submitted_at_sim`、本轮下一 `seq` 及之前已确认的判读、动作与排序事件。A 使用绑定的场景、动作目录和完整 D2 地图判定，从前缀历史计算同动作同对象的 `attempt`。B 原样追加一次 `ActionAttempt`，沿用 A 返回的 `seq`、`attempt` 和 `resource_usage.action_seq`。拒绝占一个事件序号，资源和完成时刻为空。诊断桩仍可返回 null，用于验证待接入占位。

未知动作、非场景节点时刻、非法或重复序号及错误配置通过 `ActionEngineError` 报告。未知对象、目标类型不匹配、前置条件不满足、状态冲突和资源不足通过结构化拒绝返回。拒绝按目标、目录前置条件、资源的顺序报告首项失败。违规分在 D4 计算。

## 执行、回看与路径

- A1 核查、A2 派队、A3 警戒依目录占用资源；A4 要求同楼 A3 已完成；A5 在完成时正式封闭路段；A6 要求楼栋已出现灾情标注，在完成后标记断电并拒绝再次断电。
- 资源占用是 `[提交, 完成)`；同秒后一次提交看到前一次已追加记录，完成点可立即复用。动作完成时刻使用固定模拟秒。超过 `t_end` 的预计完成时刻照常保存，结束时仍显示进行中。
- 推演使用 `port.snapshotRound(drill.currentEvents.value, currentT)`。场景提供灾情及投放，学员流水提供警戒、救援队、道路正式封闭、断电与占用。路径通过 `buildRouteQuery(map, snapshot, from, to, t)` 读取同份道路状态。独立示例回放继续使用 `port.replayTo(runId, options)` 和静态评分。
- 如 t=140 在积水导致直达中断时封闭备用路 `R-N1-GATE3`，t=164 仍可绕行，t=165 封闭完成后 N7 → GATE3 不可达。空学员流水的 t=165 仍仅有预置积水，暂无正式封闭。
- 回退到最远节点之前时限制写入，仅显示对应时刻的事件、资源和地图。返回最远节点即可继续。重置恢复首个回合并清空旧流水、事件序号、占用、播放与用时。请 B 在联调时签认回看与同秒顺序。

## 验证与 D4 接入

`npm run check:d3` 包含 D1 / D2 回归、独立规则输入、学员回合与道路验证，以及三条标准流水的 26 次动作重判。重判用每次提交之前的前缀事件，逐项核对判定、拒绝码、完成时刻、尝试号与占用。用重建流水运行 D1 基准校验器仍为 83 / 44 / 90，甲响应 45 秒。应用类型检查和构建通过。[D3 验证记录](qoder-evidence/D3-2026-11-18-action-engine.md)

Chrome 桌面 1440px 和 375px 均由正常推演入口验证 A4 拒绝与随后通过、资源冲突和释放、A5 到时封闭后路径不可达、回看及重置。报告与截图均已归档。[浏览器输出](qoder-evidence/d3-action-browser-validation.log)

D4 已从 `drill.currentEvents` 接入完整末回合排序、判断窗反馈与实时评分。回看展示使用时间截断的快照。轮次落库与恢复安排在 D6。[D4 交接与验收](handoff-d4.md)
