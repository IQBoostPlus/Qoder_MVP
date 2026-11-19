# D3 · 2026-11-18 · 六动作规则与学员流水接入

实际执行日期 11/18，原排期 11/20。D3 本地验收使用现有预置剧本、学员流水和 D2 完整地图。

## 起始状态

工作树在 `d806ba3` 上干净。实施前 `npm run check:d2` 与 `npm run build` 均通过，生产构建转换 50 个模块。提示词中提到的 `CampusMap.vue` 标签错误在本次起始版本未复现。

## 交付

- `src/action-engine.ts` 以动作目录和前缀历史判定六动作，给出完整 `ActionAttempt`，包括结构化拒绝、尝试号、完成时刻与资源占用。资源按半开区间累加，支持同秒复用、竞争和多单位占用。
- `src/engine-port.ts` 提供 `judgeAction` 和 `snapshotRound`。推演舱按学员已确认的事件派生警戒、救援队、道路正式封闭、楼栋断电和资源，路径使用同一快照。示例回放继续读取标准流水。
- 界面维护统一事件序号，判定结果原样入账，回看限制写入。已到达的未来回合操作在回退时不显示，重置恢复首个节点及空流水。诊断台的构造桩依旧可用。

## 验证与截图

- `npm run check:d3` 通过。D1 / D2 回归、六动作、同秒与多单位容量、输入错误、备选道路完成前后路线、跨结束仍进行、回看与重置均有独立断言。甲、乙、甲补做 A4 分别重判 9、7、10 次动作。原 D1 校验器对重建流水重新算得 83 / 44 / 90，甲分支响应 45 秒，甲违规参考 [14,20]、乙 [9,14,15]。[完整命令输出](d3-action-validation.log)
- `npm run typecheck:app` 与 `npm run build` 通过，生产构建转换 51 个模块。[构建日志](d3-build-validation.log)
- 使用 Chrome 157 打开本地生产构建，经正常推演入口操作。两种尺寸均验证 t=30 连续 A1 的资源冲突与 t=80 释放、t=100 先提交 A3 再提交 A4 仍拒绝、t=130 A3 完成后 A4 通过、A6 完成后地图断电、A2 救援到达，以及回看与重置。t=140 提交 A5 封闭无灾情的备用路，t=150 仍未封闭，推进到下一可见节点 t=220 时显示已在 t=165 封闭，N7 → GATE3 不可达。直达路仍显示积水且未正式封闭。两尺寸均未出现横向溢出、浏览器控制台警告、错误或未捕获异常。[浏览器输出](d3-action-browser-validation.log)

桌面 1440px：[A4 拒绝](assets/d3-engine-1440-a4-rejected.png) · [A5 后不可达](assets/d3-engine-1440-a5-unreachable.png) · [动作账本](assets/d3-engine-1440-ledger.png)

375px：[A4 拒绝](assets/d3-engine-375-a4-rejected.png) · [A5 后不可达](assets/d3-engine-375-a5-unreachable.png) · [动作账本](assets/d3-engine-375-ledger.png)

## 暂停点

已完成上述本地验证和当前交接。B 轨正式签认待补。恢复后从 [D3 交接](../handoff-d3.md) 接续，D4 使用 `drill.currentEvents` 计算实时评分并补齐末回合排序和判断反馈，D6 验证流水保存及恢复。D2 云端证据及未验项以 [原验收记录](D2-2026-11-18-cloud-acceptance.md) 为准。
