# D6-v3 · B 公开站首次云同步修复 · 2026-11-22

**修复已交付，公网待复验。** 开工基线 `b7ab61d`，`main` 与本地 `origin/main` 对齐，工作区干净。原 D6 源码为 `e504106`，B 侧界面集成和发布证据已在 `b7ab61d`。本次未提交、推送或发布，真实模型发送 0 次。[B 原发布记录](D6-2026-11-21-b-cloud-publish.md)

## A 修复与验证

空业务表的冷启动场景中，模板和场景的 `start_building_id` 都引用 `app.campus_buildings`。补上外键约束替身后，旧实现首次 PUT 得到 503。修复后的 [保存路径](../../server/run-repository.ts) 在已有归属、场景和修订号检查后，按需准备本轮起始楼栋。命中原行就直接复用；缺行时将冻结快照的楼栋字段与服务端可信 `d2-1` 数据比对，通过才写入，随后写模板和场景。并发遇 23505 回读到同一 ID 后继续。缺行且快照不匹配返回 422，楼栋读写失败保持 503。DDL、站点权限、轮次密钥及事件的提交边界沿用原实现。

- **接口替身**：有效密钥 `expected_revision=0` 的首次 PUT 200，revision 2，`N7` 先于模板、场景写入。独立 GET 200，与导出包全等，甄别／响应／覆盖／违规为 10／0／0／100，总分 18。已有楼栋保留原值，同模板另一合法起点 `N1` 按需新增，`GYM` 的 `floors=null` 保留。双请求同时读空表时，两轮均 200，只有一条楼栋，失败方经 23505 回读继续。伪造楼栋返回 422，非唯一键错误和冲突后查无行返回 503，均无可读新轮次。
- **实际本地 PostgreSQL**：PGlite 0.5.16 / PostgreSQL 18.6 应用 D2、D5、D6 Sites SQL 后保持空表，以 JSON 结果适配器运行生成后的 Sites Function，同源路径首次 PUT 200 / revision 2，重复 PUT 200，独立 GET 200。与导出规范化全等，复算四项和总分同上，楼栋表只新增 `N7`。这是隔离数据库与 Function 应用层验证。
- **构建和回归**：`npm run build:sites:d6`、`npm run check:d6`、`npm run typecheck:app`、`npm run build` 均 EXIT 0。固定评分 83／44／90／83，幂等 PUT、旧修订 409、无效密钥 404、半写入不可见继续通过。
- **产物**：`cloud-verify/functions/d6-shared.mjs` 按 `server/sites-d6.ts` 生成，SHA-256 为 `3a9c41c1b8a249092b61ba46e0c78e58412729422ca36b2f43f83dd46727fbfc`。

## B 合入与发布

交付包 `D6-v3-B-first-sync-fix.zip` 内含 `D6-v3-first-sync.patch`、生成的 `cloud-verify/functions/d6-shared.mjs`、本复验单和执行日志。B 在自己的集成版本根目录应用补丁，并重新构建 Function。

```powershell
git apply --check <解压目录>/D6-v3-first-sync.patch
git apply <解压目录>/D6-v3-first-sync.patch
npm run build:sites:d6
npm run check:d6
Get-FileHash cloud-verify/functions/d6-shared.mjs -Algorithm SHA256
```

在 B 的 `campus-drill-sandbox-kqvhf8qsvw2.qoder.zone` 重新发布 Function。沿用数据库、同源路径及 `D6_ENABLE_RUN_SYNC=1`，关闭生成和测试开关。平台若需要全量站点发布，沿用 B 的 `cloud-verify/dist/b-publish` 布局，验证 D6 为根入口、`/d5/index.html` 原样保留。`build:sites:d6` 的 `dist/d6` 只含新构建的 D6 页面，完整发布还需 B 的原 D5 静态资产。记下 action、deployment ID、实际产物 SHA-256 和最终发布状态。

## B 公网复验

11 月 21 日旧版使用有效轮次密钥的同源首写为 503。11 月 22 日本次只读复核根入口、`/d5/index.html` 均 200，无密钥 GET 404。本次没有 B 修复版发布回执，因此没有执行公网有效密钥的写入或独立读回。

1. 只读核对选用起始楼栋是否存在。选择一个缺行的合法预置起点，从匿名浏览器正常训练，提交判读或动作，点击同步。记录首次 PUT 200、修订号及起始楼栋读回。若所有合法起点均已存在，记录实际覆盖，空库结论沿用隔离测试。
2. 继续完成同一轮并同步，导出该修订号的 JSON。使用浏览器持有的本机轮次密钥独立同源 GET，对比 `run` 与导出快照，独立复算四项和总分。刷新核对「已从本机恢复」。原内容重放 PUT 应为 200，旧修订更新应为 409，缺密钥和错密钥应为 404。一次断网保存后联网同步同一轮，核对本机留存及恢复效果。
3. 单列实际后台 403 的路径、发起方、状态及影响，并与跨源请求被网关拒绝、同源请求进入保存后失败分开记录。当前 403 没有新的定位证据。保留同源与轮次密钥检查。
4. 若仍有同源 503，先确认实际部署加载本次 Function、同步开关和 Function 路径，再查起始楼栋是否入库，以及失败的表和数据库错误码。保留原轮次并在同一个 `run_id` 上重试。证据只保留脱敏 ID、状态、修订号、分项、表行数和控制台结果。

取得 B 公网首写 200、独立 GET 与导出全等、评分复算一致的回执后，再关闭公网云同步阻塞。
