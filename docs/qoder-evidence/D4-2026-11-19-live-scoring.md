# D4 · 学员流水实时评分与末回合复盘

**实测日期** 2026 年 11 月 19 日。此条记录为 Codex 本地工程验证。本轮使用本地 Chromium 浏览器与项目内置剧本，Qoder 配额消耗为零。脚本按样例操作序列驱动正常页面控件，评分从此次的事件计算。

## 执行记录

- [`d4-score-validation.log`](d4-score-validation.log) 保存 `npm run check:d4` 输出，包含 D1–D3 回归，D4 四项评分的手算核对、分时段改判、定位独立、排序校验、重复违规下限、重复命中和跨结束时刻的动作。
- [`d4-build-validation.log`](d4-build-validation.log) 保存 `npm run typecheck:app` 和 `npm run build` 输出。
- [`d4-score-browser-validation.log`](d4-score-browser-validation.log) 保存本地 Chrome 1440px / 375px 生产构建结果。两种宽度均完成四条路径、排序、判读复盘、只读回看、结算停表、重置、跳过排序及示例回放 83 分，控制台警告、错误与页面异常均为 0。

## 页面验证

通过时间轴进入操作节点，在上报卡片判读并改判，从地图点选对象提交动作，于 T+300 填写排序并结算。逐项对照四个分项、总分、响应秒数与违规账本引用。T+150 的 A4 实际通过、预计 T+170 完成。T+100 的 A4 实际拒绝，原有命中不变。浏览器按甲的原顺序操作并在该节点末尾追加补做动作，流水序号会随插入位置变化。

| 实时推演 | 甄别 / 响应 / 命中 / 违规 | 总分 | 桌面 | 375px |
| --- | --- | ---: | --- | --- |
| 甲 | 80 / 100 / 80 / 70 | 83 | [截图](assets/d4-1440-score-83.png) | [截图](assets/d4-375-score-83.png) |
| 乙 | 60 / 0 / 50 / 55 | 44 | [截图](assets/d4-1440-score-44.png) | [截图](assets/d4-375-score-44.png) |
| 甲，T+150 加做 A4 | 80 / 100 / 100 / 70 | 90 | [截图](assets/d4-1440-score-90.png) | [截图](assets/d4-375-score-90.png) |
| 甲，T+100 加做 A4 | 80 / 100 / 80 / 70 | 83 | [截图](assets/d4-1440-score-83-early-a4.png) | [截图](assets/d4-375-score-83-early-a4.png) |

[桌面排序](assets/d4-1440-sort.png) · [375px 排序](assets/d4-375-sort.png) · [桌面逐条反馈](assets/d4-1440-judgment.png) · [375px 逐条反馈](assets/d4-375-judgment.png)

人工签认和独立试用用时未测。公网发布、云端 Agent 及轮次持久化均待各阶段验收。[D4 交接](../handoff-d4.md)
