# D0（规划期，D1 前） · 2026-11-17 · 校园建筑数据真实化与手算样例对齐（v4.1）

| 项 | 内容 |
| --- | --- |
| 责任人 | A+B（契约与样例属共同交付） |
| 轨道 | 引擎侧数据 + 界面侧渲染输入 |
| 关联功能 | F1、F6（地图与路径）、F4、F5（模拟上报）、F8、F9（评分与复盘） |
| 状态 | 已完成（文档层面）。代码与 fixture 落地属 D1 |

## 1. 想完成什么

原样例使用虚构建筑（`B7` / 7号宿舍楼 / 食堂 / `R-East`），与真实校园脱节，学员练不到本校值班员实际会听到的地名。用户提供了 [`njit-campus-buildings.md`](../njit-campus-buildings.md)（江宁校区建筑调研，含层数与来源置信度），要求把建筑数据整体换成真实数据。

同时 README「D1 样例待对齐」列出三处会使 D1 契约自相矛盾的缺陷，需在冻结前一并修掉。

## 2. 在 Qoder 中做了什么

在 Qoder 对话中给出调研文档，要求「整体的改一下，之前的建筑数据不对，更新成这个」，随后要求推送。助手执行：

1. 先读取仓库当前状态，发现 README 已被外部评审重写（commit `262d4c5`），新增「D1 样例待对齐」三处矛盾；`njit-campus-buildings.md` 已由用户提交（`405edb1`）。**未覆盖外部改动**，在其基础上修订。
2. 从调研文档的 57+ 栋建筑中按三个模板的落点需求**选点 20 栋**，新增 `requirements.md` §7（选点原则、20 栋清单、路口与路段、D1 fixture 8 栋子集）。
3. 样例起始楼栋 `B7` → **`N7`（萃园 7 幢 / 北 7）**，阻断路段 `R-East` → **`R-N7E`**（N7 → GATE3）；U5 的「东门」改为「3号门」以符合北区地理位置（调研文档：3 号门近北区）。
4. `Building` 类型增加 `zone`、`floors`；新增 `Junction` 类型承载校门与路口，**明确不计入 20 栋**。
5. 修掉三处矛盾（详见下表），并同步 `quality-verification.md` 的 SC / JW / TC / RE 用例与 D4 判据。
6. 取消 v3 计划的 OpenStreetMap 轮廓参考——自绘 SVG 后 OSM 非必要输入，避免署名与覆盖度不确定性。
7. 提交并推送至 `IQBoostPlus/Qoder_MVP`。

**三处矛盾的处理**

| 矛盾 | 处理 |
| --- | --- |
| A4 广播疏散前置 A3 警戒，但两分支都漏 A3 却把 A4 计入命中 | 保留规则。两分支成功的 A4 换为同权重 A3；甲漏 A4、临场补做 A4；乙在 t=250 提交 A3（duration 30 → 完成 280），与 A2 同时完成，首个有效响应仍为 280 |
| U9 把路段 id 塞进 `building_id`，而界面只让选楼栋 | `building_id` 改填位置参考楼栋 N7；阻断对象 R-N7E 由 t=140 的 disaster 事件单独引用，A5 封路作用于路段。定位与改道分别核对 |
| 样例含 35 / 95 / 220 等节点外操作时刻 | 新增 FR-4.7：回合内操作 `t_sim` 一律等于当前节点值，不插值；剧本补 220、250 两个推进回合 |

- 对话截图：`assets/D0-campus-data-v41-chat-01.png`（**待用户补拍**）
- 生成结果截图：`assets/D0-campus-data-v41-result-01.png`（**待用户补拍**，建议截 requirements §7.2 的 20 栋清单）

## 3. 如何验证

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| 三个目标分数不变 | Node 复算加权和与四舍五入 | 甲 82.5→**83**、乙 43.75→**44**、补做 A4 89.5→**90**，全部通过 |
| 响应时长换算 | Node 复算分段函数 | 45 秒→**100**；250 秒→**0**，与手算表一致 |
| 新增 SC-08 期望值 | Node 复算 | 乙 A3 提前到 220 → 响应 220 秒 → 11.1111 分 → 总分 45.97→**46** |
| 违规项可达值 | Node 枚举 0～7 次 | 100,85,70,55,40,25,10,0；**60 不可达**，与 SC-05 一致 |
| 权重自洽 | Node 求和 | 动作总权重 **10**；甲命中 **8**、乙命中 **5** |
| 20 栋 / 8 栋 / 8 路段计数 | 人工核对 §7.2、§7.3、§7.4 | 20 栋、fixture 8 栋、8 条路段；路段端点全部落在 fixture 内，路网连通无孤立楼栋 |
| 旧标识符残留 | 全仓 grep `B7\|R-East\|7号楼\|东门\|OSM` | 仅存于历史对照行、已废止的 `mvp-spec.md` 与调研文档本身，正文无残留 |
| 推送结果 | `git ls-remote` | 远端 `main` = `a10927f2524aea30d36617463caca2b3540bdb91`，本地同步、工作树干净 |

**纯 CLI 验证，无界面可截图，按约定粘贴完整命令与输出作为等效凭证：**

```
$ node -e "<复算脚本：加权和、响应分段函数、违规枚举、权重求和>"
甲 83 ? 83 raw 82.5
乙 44 ? 44 raw 43.75
补A4 90 ? 90 raw 89.5
SC-08 46 ? 46 resp 11.1111
甲响应45s -> 100  乙响应250s -> 0
违规可达值 100,85,70,55,40,25,10,0
权重和 10 甲命中 8 乙命中 5

$ git add README.md docs/requirements.md docs/quality-verification.md \
        docs/qoder-evidence/README.md docs/qoder-evidence/_template.md
$ git commit -m "docs: ground campus data in real NJIT buildings and align canonical sample (v4.1)"
[main a10927f] docs: ground campus data in real NJIT buildings and align canonical sample (v4.1)
 5 files changed, 347 insertions(+), 92 deletions(-)
 create mode 100644 docs/qoder-evidence/_template.md

$ git -c http.sslBackend=schannel push origin main
To https://github.com/IQBoostPlus/Qoder_MVP.git
   405edb1..a10927f  main -> main

$ git -c http.sslBackend=schannel ls-remote origin main
a10927f2524aea30d36617463caca2b3540bdb91	refs/heads/main
$ git status --short --branch
## main...origin/main
```

> 网络前置条件：github.com:443 直连不通，需 Clash Verge 代理（127.0.0.1:7897）；git 的 `http.sslBackend=openssl` 缺 CA bundle，故每条命令临时加 `-c http.sslBackend=schannel`。**未修改持久 git config，未关闭证书校验。**

## 4. 结论与后续

文档层面已达成：建筑数据真实化、三处矛盾消除、分数算式可复算、已推送。

**尚未验证、属 D1 工作的部分**：

- `src/contracts.ts` 与 `fixtures/canonical-run.json` 尚未生成，本文档只是规格。
- 20 栋的**平面几何仍未构造**（归 A）。调研文档不提供坐标，§7 只给名称、分区、层数与相对位置描述。
- 83 / 44 / 90 目前是**手算 + Node 复算**通过，**不是引擎输出**。D4 检查点要求由真实评分函数实时算出，并附一正一反两个临场改动（合法补做 A4 → 90；前置未满足时补做 A4 → 被拒、仍 83）。
- 三处矛盾的处理由助手按 README 建议采纳，**仍需 A、B 在 D1 上午确认**，尤其是乙分支 A3 的 t=250 时刻——改动它会直接改变总分（见 SC-08）。

**对 B 轨 D1 提示词的影响**：fixture 8 栋由泛指改为明确的 **N7、N1、N2、N11、CN1、CN2、GYM、LIB + GATE3 + 8 条路段**；样例起始楼栋为 N7，阻断路段为 R-N7E。渲染代码不得硬编码任何楼栋 id、名称或坐标。

## 5. 待补凭证

- [ ] Qoder 对话截图：给出调研文档并要求整体替换建筑数据的那一轮（`assets/D0-campus-data-v41-chat-01.png`）
- [ ] 结果截图：`requirements.md` §7.2 的 20 栋清单渲染效果（`assets/D0-campus-data-v41-result-01.png`）
- [ ] GitHub 提交页截图：commit `a10927f` 的 diff 概览（`assets/D0-campus-data-v41-verify-01.png`）
- [ ] A、B 确认三处矛盾处理方式的记录（D1 上午契约冻结时补）