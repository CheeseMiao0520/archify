# Code Analysis 第一批提交准备

日期：2026-10-17。范围：整合 Claude C1–C5 与 Codex U1–U6，处理本批相关失败，重建包并准备可审阅的变更；附 AI 交接产品设计。未提交、推送或创建 PR。

## 基线和提交边界

- 当前分支：`claude/code-analysis-ai-tasks`；增量基线 `3c4c4766200fa959ca5cd399d1d7bcb37820af8e`。
- 已刷新 `upstream/dev`：`30f8fc63c9bc1f3ab5ae7192eaae4eceafec547f`。该分支尚未包含 Code Analysis；当前功能历史与 dev 的共同祖先为 `f3cc060f`，两侧分别有 30 / 1064 个提交。
- 因此本次是依赖现有 Code Analysis 功能历史的提交准备，不宣称这份增量可以直接合并最新 dev；迁移整个功能历史到 dev 应独立评估。没有对用户的脏工作树执行重置、合并或大范围 rebase。
- 仅暂存本批模块、CLI 接缝、浏览器测试、相关设计/交接记录及 `archify.zip`。`Claude outputs/`、`labs/`、`local/` 与已有未跟踪 MCO receipt 均未纳入提交。

## 用户可见行为

分析结果从前三优先项进入代码证据，函数范围与触发行可核对。问题标题附近新增 **Copy task for AI**：无需先展开长任务预览，一次点击即准备并复制包含事实、建议、证据、允许修改范围及验收要求的完整任务。剪贴板拒绝时自动打开预览并选中文本。

当前没有连接 AI 接收端，所以 UI 如实显示“复制后粘贴”，不把复制称作已发送。后续的“已连接时一键发送、未连接时一键复制”方案、接口、回执及分工见 [AI 交接设计](code-analysis-ai-handoff-design.md)。

## 收尾中发现并修正的问题

1. 干净解压包中，首次运行 `check` / `task` 会缺少 `ajv`；现在两者在加载分析库前复用 `ensureDependencies`，与 serve 一样按 lockfile 初始化模块依赖。已在两个仓库外的新解压目录分别验证 check 和 task 首次使用，并通过 package smoke。
2. Windows 上的 comparability fixture 用 `URL.pathname` 得到错误的盘符路径；已改为 `fileURLToPath`。
3. 新任务 Markdown 的空源码行带尾空格，影响 `git diff --check`；生成器现在给空行输出无尾空格的行号分隔符，fixture 已按同一生成器刷新。
4. 自分析子进程断言此前只显示 `1 !== 0`；补充实际 stdout/stderr/启动错误，后续失败可以直接定位，未改变测试通过条件。
5. CLI 测试现明确验证 serve/check/task 三个入口，而非保留过时的“两条命令”描述。

## 原 30 项全仓失败的排查

使用 `3c4c4766` 的独立 baseline worktree，复用相同 Node 和已安装的仓库依赖进行对照。没有修改原工作树的无关源码和证明材料。

- **归档及消费环境**：Git Bash 实际位置为 `D:/Git`。设置 `BASH` 并把 Git `bin` / `usr/bin` 放入测试进程 PATH，解决找不到 bash/unzip 的问题；收录新模块并重建 ZIP 后，package gates 与 Code Analysis 集成共 42 项：36 通过、6 跳过、0 失败。Cursor 包消费两项均通过。
- **比较恢复**：原全仓的 9 项失败在未改动的 baseline 同样出现；未把它们作为本批功能修改。
- **Windows 别名、Star History、pinned evidence**：相同筛选在 baseline 与候选各有 10 项失败，测试名称一致，属于当前基线/平台条件下可复现的问题。
- **MCO 两项**：baseline 自动发现不到相邻 MCO clone 时，其字节复现测试会跳过，不能拿这个跳过冒充通过。显式使用同一 pinned clone，并在 baseline 复制当前原本就存在的未跟踪 receipt 后，两侧均为 1 通过、2 失败。MCO 已跟踪 HTML 和 renderer 的 blob 与 HEAD 一致；保留该无关 receipt，未为消除失败擅自覆盖它。其修复不纳入本批。
- **自分析提取**：原全仓嵌套模块失败在 baseline 也出现；独立的候选模块/集成复跑通过。现已增加子进程诊断，最终冻结版全仓结果另见下文；不能仅凭一次复跑通过断言其根因已解决。

这一区分证明哪些问题在同等条件的基线上复现，以及哪些已经通过环境/打包修正；不等于整个旧功能历史对最新 dev 的兼容性验证。

## 验证与证据

本地证据目录：`out/batch1-final/`。

- `candidate-gates-final.log`：归档与 Code Analysis 集成，36 通过、6 跳过。
- `cursor-package.log`：2 通过。
- `focused-final.log`：任务、比较、自分析专项，20 通过。
- `browser-final.log`：含一键复制、证据状态、下载、离线、长路径、键盘及空/大量结果，5 项 Chrome 回归通过。
- `package-smoke-final.log`：仓库外解压的最终包 smoke 通过。
- `extracted-check-final.json`、`fresh-task-receipt.json`：两次独立干净包首次使用成功，实际依赖安装使用本机 npm 缓存，未安装到 live Archify。
- `baseline-failures.log`、`baseline-platform.log`、`candidate-platform.log`、`baseline-proof-matched.log`、`candidate-proof.log`：基线对照。
- `full-final.log`：使用正确 Windows 工具路径，在冻结的模块源码和 ZIP 上运行最终完整测试。2062 项中 1946 通过、20 失败、96 跳过，耗时约 322 秒。剩余失败为比较恢复 9 项、Windows 8.3 别名 1 项、MCO 2 项、pinned evidence 8 项，均有上述基线对照。Star History 在正确工具路径下通过，自分析嵌套回归本轮通过；全仓仍非全绿。

最后一轮完整测试运行期间，仅继续整理仓库外的审阅文档，没有再修改其扫描的 `archify/` 源码和 ZIP。模块源码、测试及 ZIP 已作为第一批暂存；本文件和最终审阅材料在全量结果确定后追加暂存。

## 生成产物

`archify.zip` 已从本批明确暂存的 tracked 源码、Node 22 重建，包含新 task/evidence/schema 文件；没有把任意未跟踪目录带入包。已在仓库外解压验证。Viewer 源模板未改，无需 generate:viewer；未重建无关站点、Gallery、MCO 展示产物。未改版本号、发布标签或分发身份。

## 建议的提交说明

标题：`Add evidence-backed AI task handoff to Code Analysis`

用户在定位复杂函数、依赖循环或边界问题后，可直接复制包含代码证据、建议方向、修改范围与验证要求的 AI 任务。在线交接前复核源码，离线结果明确标为捕获快照；比较区分“不再检测到”与已验证修复。

整合任务契约、证据验证、CLI 与阅读界面，修正干净包首次 check/task 的依赖初始化，并补齐浏览器和包消费证据。直接发送到编程 AI 的连接器属于单独设计与后续实现，不在本次伪装为已交付能力。

提交可供当前功能增量审阅；对最新 dev 的移植、原有平台失败、远端 CI/分支保护及独立用户试用仍是后续整合条件，不以本地专项成功替代。
