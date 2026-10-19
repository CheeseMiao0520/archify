# Archify finalize 经过哪些模块？失败时旧产物怎么保住？ {#finalize-modules}

`finalize` 是编排器，不是渲染器：`runFinalize` 按序调用 `deliver → check → browser-check` 三个子命令（validate 内嵌在 deliver 里），每道门用 sha256 与 `receiptId` 验收回执绑定的是本产物，第一道失败即停。旧产物只在 deliver 的提交点被替换。新 HTML 先在同目录 `.archify-delivery-*` 暂存区渲染并通过检查，提交时旧文件先备份、再用硬链接换上。中途失败自动回滚，连回滚都失败就保留恢复目录。

- 三道门复用同一个 CLI；finalize 校验每份回执的类型、字节数与哈希。[](source:finalize-mjs)
- 提交前目标路径零写入；提交时先备份再 `linkSync`，任何绑定不符即中止。[](source:commit)
- 交付锁与 pending journal 让中断 fail-closed：并发被拒，残留态不可信。[](source:deliver)
- 边界：commit 成功后 check 或 browser-check 失败不回滚，旧产物只保到提交点。

@answer scope="Archify @ 82c47ca · bin/finalize.mjs + archify.mjs · explainer 默认无 browser-check 门"
@meta locale=zh-CN repo_url=https://github.com/tt-a1i/archify repo_revision=82c47ca31d83749020ff30d6b1172248e71d255d
@source finalize-mjs title="runFinalize 编排器" path=archify/bin/finalize.mjs lines=722:1050
@source commit title="commitDeliveryPair：备份、提交、回滚" path=archify/bin/archify.mjs lines=3236:3624
@source deliver title="commandDeliver 交付主流程" path=archify/bin/archify.mjs lines=4400:5301
@source check-cmd title="check 与 provenance 检查" path=archify/bin/archify.mjs lines=5418:5659
@source recover title="recover-output.mjs 恢复入口" path=archify/bin/recover-output.mjs lines=1:41

## finalize 把一次交付拆成哪几道门？ {#gates}

explainer 候选先经 `prepareExplainerInput` 编译成冻结 bundle，每道门前后复核其依赖未变。原生图默认三道门全跑；explainer 只跑 `deliver + check`，加 `--browser-check` 才开浏览器门。

@workflow id=finalize-gates title="finalize 的模块链"
| lane orch | 编排 bin/finalize.mjs |
| lane del | 交付 deliver 子命令 |
| lane ver | 验证子命令 |
| cli | commandFinalize 解析参数 | backend | orch |
| snap | 快照候选·开收据 | backend | orch |
| del | 锁+journal+暂存渲染 | backend | del |
| commit | commitDeliveryPair | backend | del |
| chk | check 严格复查 | backend | ver |
| brw | browser-check Chrome | backend | ver |
| rec | .finalize.json 收据 | database | orch |
| cli > snap | |
| snap > del | |
| del > commit | |
| commit > chk | pass |
| chk > brw | pass |
| brw > rec | |

@steps id=gate-steps
| parse | commandFinalize 解析参数 | 解析质量、repo、out-dir；explainer 预编译为冻结 bundle；并行启动有界 update 检查。 | finalize-gates | cli |
| snap | 快照候选·开收据 | 记录输入 sha256；两个收据路径先原子捕获再写。 | finalize-gates | snap |
| del | 锁+journal+暂存渲染 | 拿交付锁、写 pending journal，渲染与自检都在暂存区；任一门失败即停并写诊断。 | finalize-gates | del |
| chk | check 严格复查 | provenance=current 且 sha 匹配后跑严格检查，再过浏览器门。 | finalize-gates | chk |

## 哪一步失败，旧产物处于什么状态？ {#failure-matrix}

| 失败点 | 输出路径上的旧产物 | 保护机制 |
| --- | --- | --- |
| 参数、输入或 validate 失败 | 原样未动 {good:安全} | 渲染前不碰目标；交付锁都还没拿 |
| 暂存渲染或 deliver 内 artifact 检查失败 | 原样未动 {good:安全} | 候选只写 `.archify-delivery-*`；检查失败报 previous artifact was preserved |
| `commitDeliveryPair` 中途失败 | 自动回滚 {good:安全} | 旧文件先备份成 `.previous-output` 与 `.previous-provenance`，异常时逐一 link 回目标并复核绑定 |
| 回滚失败或锁丢失 | 留在恢复目录 {caution:需手工} | `recoveryRequired`：暂存目录不清理，`recover-output.mjs` 可恢复旧文件 |
| 并发另一次 deliver，或残留 lock/pending | 被锁挡住 {good:安全} | `delivery/concurrent-attempt` 或 `lock-stale`，新交付拒绝开始 |
| deliver 已提交后 check、browser-check 失败 | 已被新产物替换 {caution:边界} | 新产物已过自身检查；finalize 标 fail、写诊断，不自动回退 |

## 一次 finalize 在磁盘上留下哪些文件？ {#sidecars}

| 文件 | 角色 |
| --- | --- |
| `<out>.delivery.json` | 成功 provenance：`receiptId`、spec 与 artifact 的 sha256、validation 摘要 |
| `<out>.delivery-pending.json` | 进行中 journal；提交时删除，残留即交付中断的证据 |
| `<out>.delivery-lock.json` | 交付锁；挡住并发与 stale 交付 |
| `<out>.browser-check.json` | 浏览器证据回执；原生图默认产出 |
| `<out>.finalize.json` 与 `-summary.json` | finalize 完整与压缩回执，经临时文件加绑定原子发布 |
| `.archify-delivery-*` 目录 | 暂存区：spec 快照、渲染候选、`.previous-*` 备份；正常清理，需恢复时保留 |

## 交付中断后按什么顺序确认？ {#recovery}

- [ ] 看 `.finalize-summary.json` 的 `failedStage` 与 `diagnostics[].supportedFixes`，定位停在哪道门。
- [ ] 报 `recoveryRequired` 时，运行 `node bin/recover-output.mjs <暂存目录>` 恢复保留的旧文件。
- [ ] 发现残留 lock 或 pending 时，按诊断先串行恢复再重试，不直接删文件。
- [ ] 需要回到旧版本时，提交点之后只能用自己的版本控制或备份。
