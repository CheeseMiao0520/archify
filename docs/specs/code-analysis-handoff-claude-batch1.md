# Code Analysis 第一批交接：Claude（C1–C5）

日期：2026-10-17
依据：[协作实施计划](code-analysis-execution-plan.md)第 4 节
基线：`codex/code-analysis-module` `3c4c4766200fa959ca5cd399d1d7bcb37820af8e`
候选：分支 `claude/code-analysis-ai-tasks`，改动**尚未提交**（工作树）。未刷新远端 `dev`，不构成合并就绪结论。

本文是 Claude 给 Codex 的交接材料。Claude 未修改 `overlay/inject.mjs`（UI 与共享接缝），也未修改浏览器测试。

**后续 UI 交付**：Codex 已完成 U1–U6 的界面与交互接入，包括 evidence-first 阅读、函数区间、在线/离线任务预览复制下载及状态提示。最终五项 Chrome 回归通过，详见 [UI 交付记录](code-analysis-ui-batch1-delivery.md)。下文“需要 Codex 跟进”的原始交接项保留历史上下文，其页面接入及 fixed 文案现已处理；发布整合及用户试用尚未据此完成。

**Codex 补充验收（2026-10-17）**：已在外部真实项目 CodeBoarding 的独立源码副本上完成 CLI 导出任务 → Codex按任务修改 → 旧证据失效检查 → 同配置重分析。目标函数嵌套从 5 降至 4；结果可比较、无新增 finding；既有健康配置测试 9 项和 1813 组行为对照通过。外部项目完整套件的原始/候选均为 2007 通过、69 失败、4 跳过，失败清单完全相同；没有宣称全套通过。当前工作树四项 Code Analysis Chrome 回归均通过。详见[外部案例验收记录](code-analysis-batch1-external-validation.md)。这补齐了下文所述外部案例，页面 AI 导出入口仍由 Codex后续接入。

**AI Voice 补充案例**：同样完成独立副本上的 CLI 闭环。`split_stream` 复杂度 19 → 10、嵌套 5 → 3；12810 组流式行为对照通过；182 文件同配置重分析可比较、无新增 finding。非 UI 测试前后均为 474 执行、9 失败、21 跳过，失败清单一致；完整 runner 在 UI 测试中提前退出，未记为通过。详见 [AI Voice 验收记录](code-analysis-batch1-ai-voice-validation.md)。

## 1. 交付内容

| 编号 | 内容 | 位置 |
|---|---|---|
| C1 | AI 任务契约与真实 fixture | `schemas/ai-task.schema.json`；`test/fixtures/py-tasks/`（源码）；`test/fixtures/tasks/`（生成的示例） |
| C2 | 任务生成器（JSON + Markdown 同源）与 CLI | `lib/task.mjs`；`bin/task.mjs`；`archify code-analysis task` |
| C3 | 证据校验 | `lib/evidence.mjs`；`task --verify`；serve `POST /task` |
| C4 | 配置深合并；结果可比较性；`fixed` → `notDetected` | `lib/analysis.mjs`；`evaluate/index.mjs`（`findings.analysis`）；`lib/review.mjs`；`overlay/overview.mjs` |
| C5 | 测试与文档 | `test/task.test.mjs`、`test/comparability.test.mjs`、`test/interactive.test.mjs`（新增 /task 用例）；README / USAGE / ARCHITECTURE / TECH-GUIDE |

路径均相对 `archify/modules/code-analysis/`。

## 2. 任务数据契约（供 U4/U5 接入）

完整定义见 `schemas/ai-task.schema.json`，各类问题与各状态的示例见 `test/fixtures/tasks/`：

| 文件 | 内容 |
|---|---|
| `complexity.task.json/.md` | 复杂度（整函数区间，`focusLine` 为最深嵌套行） |
| `import-cycle.task.json/.md` | 文件导入循环（沿循环路径的每条 import） |
| `module-cycle.task.json/.md` | 模块循环 |
| `boundary.task.json/.md` | 架构边界（`scope.modify` 只含越界导入方，目标层文件在 `scope.read`） |
| `complexity.task.valid.json` | 校验后 valid：函数上方插入注释，`currentStartLine` 给出新位置 |
| `import-cycle.task.changed.json` | 校验后 changed：被引用的 import 行改变 |
| `boundary.task.missing.json` | 校验后 missing：导入方文件已删除 |
| `findings.json`、`raw-facts.json` | 生成上述任务的真实分析快照 |

重新生成：`node test/task-fixtures.mjs`；`test/task.test.mjs` 会检查已提交示例是否过期（忽略机器相关的 Python 版本与 snapshotId）。

UI 需要的主要字段：

- `title`、`taskId`（同一组 finding + 同一证据 → 同一 ID）、`findings[]`（id、code、severity、review 状态）。
- `locations[]`：`file`、`startLine`/`endLine`、`symbol`、`kind`（function / import / range / file）、`note`、`excerpt.segments[]`（`startLine` + `lines[]`）、`excerpt.omitted[]`、`excerpt.complete`。校验后增加 `status`、`reason`、`currentStartLine`/`currentEndLine`。`kind: "file"`（hub）没有行区间，`excerpt` 为 null。
- `facts[]`（检测事实，即 finding message + 关键证据）、`impact[]`（可能影响）、`suggestions[]`（建议方向，非已证实缺陷）三者分开存放。
- `scope.modify` / `scope.read` / `scope.note`、`preserve[]`、`acceptance[]`、`verification`（`reanalyze` + 仅由调用者提供的 `commands[]`）、`toConfirm[]`、`instructions[]`。
- `evidence.status`：`captured`（仅快照，未对照工作树）| `valid` | `changed` | `missing` | `unverifiable`；`evidence.checkedAt`、`evidence.reason`、`evidence.findings[id]`（`status`、`reason`、`digestMatches`）。

文案约定：Markdown 由 `renderTaskMarkdown(task)` 统一生成，UI 复制时直接用服务端返回的 `markdown`，不在前端另拼文本。

## 3. 接入方式（Codex 决定 UI 采用哪种）

**A. 有本地服务（推荐）**：页面 `POST /task`，请求头与 `/analyze` 相同（`Origin` + `X-Analysis-Token`），`Content-Type: application/json`，正文 `{"ids": ["COMP-…"]}`（1–20 个）。

| 状态码 | 含义 |
|---|---|
| 200 | `{ task, markdown }`，已对照当前工作树校验 |
| 400 | 正文不是 JSON / ids 不合法 |
| 403 | Origin 或 token 不符 |
| 409 | `task/no-analysis`（尚未分析）或 `task/analysis-running`（重分析进行中） |
| 413 | 正文过大 |
| 422 | `task/finding-unknown` 等（ID 不属于当前结果，例如页面是旧结果） |

请求只携带 finding ID；结果目录与仓库根目录由服务端固定。

**B. 静态报告（无服务）**：在 `buildOverlay` 中调用 `buildTaskPayloads({ findings: <findings 文档>, facts, review })`，得到 `{ [findingId]: { task, markdown } }`，状态均为 `captured`。注意 `buildOverlay` 目前只拿到 `findings.diagnostics`，需要把完整 findings 文档（含 `repository`、`analysis`）传进去，这是共享接缝，由 Codex 修改。体量参考：本模块自分析 41 项 ≈ 520 KB（JSON 与 Markdown 各一份）；若嫌大，可只嵌入 `markdown`，或只为前若干优先项预生成。

## 4. 比较语义变化（影响 U5 与现有复审文案）

- `review.json` 的 `comparison` 新增：`comparable`（true / false / null）、`reasons[]`（`config-changed`、`rules-removed`、`rules-added`、`rules-changed`、`analyzer-changed`、`language-changed`、`scope-changed`、`parse-errors`、`context-missing`）、`notDetected[]`（每项可带 `likelyCause`：`rule-not-run`、`files-missing`、`parse-error`、`possibly-renamed` + `candidates`）。
- `fixed` 保留为 `notDetected` 的兼容别名（内容相同），现有页面不受影响。`overview.review.comparison` 同样带上 `comparable`、`reasons`、`notDetected`。
- **需要 Codex 跟进**：`overlay/inject.mjs` 第 924–925 行仍显示 “fixed” / “Fixed since the previous analysis”。建议改为 “no longer detected”，并在 `comparable !== true` 时显示原因；`likelyCause` 可显示在条目旁。CLI 文本已改为 “no longer detected”，不可比较时附原因。
- `findings.json` 新增可选的 `analysis` 块（分析器版本、配置摘要、规则版本、覆盖信息）。旧结果没有该块仍然有效，比较时 `comparable: null`。

## 5. 配置合并（C4）

`--config` 改为深合并：对象逐层合并，数组整体替换（`include`、`exclude`、`ignore`、各 role 的 globs），标量与 `null` 替换；关闭规则只用 `ignore`。非对象或非法 JSON 报 `cli/config-invalid`。行为变化：以前只写 `roles.test` 会丢掉默认的 `roles.generated`，现在保留。另外核实：serve 每次重分析都会重新读取 config 文件，因此 config 改动只需 Re-analyze；README / USAGE / ARCHITECTURE 中“需重启”“唯一入口”的过时说明已更正，只有架构 JSON 变化需要重启。

## 6. 验证结果（2026-10-17，链接的 Linux VM，Node 22.23.2，Python 3.10.12）

- 模块测试：153 通过、2 跳过、0 失败（基线 134 通过、2 跳过）。因单次命令时限分两批执行：前 12 个文件 98 通过、2 跳过；其余文件加 `extract-self` 55 通过。新增 19 项：`task.test.mjs` 12、`comparability.test.mjs` 6、`interactive.test.mjs` 中 `/task` 1。
- 改动中途 `extract-self` 曾失败一次：新测试从 `test/fixtures/` 导入生成器，而自分析排除了 fixtures，导致 2 个未解析导入。生成器移到 `test/task-fixtures.mjs` 后通过。
- `archify/test/code-analysis.test.mjs`：2 通过。
- `archify/test/release-package-gates.test.mjs`：36 通过、2 跳过、2 失败。
  - `archive build excludes untracked files…`：环境原因（当时连接的文件夹不允许删除，测试无法清理临时文件）；授权删除后单独重跑通过，测试残留的 4 个 `.package-negative-*` 临时文件已删除。
  - `archive build is byte-for-byte reproducible…`：已提交的 `archify.zip` 与当前 tracked 源码不一致。本批修改了 Skill 运行时内 tracked 文件，预计是这个原因；未在基线上对照验证。按计划，ZIP 由最终整合者从合并后的源码统一重新生成。
- 浏览器回归（`archify/test/code-analysis-*-browser.test.mjs`）**未运行**：该 VM 没有 Chrome。本批未改 UI 代码，但 `overview.review.comparison` 增加了字段，需在 Codex 环境跑一次。
- 真实性抽查：对本模块自身（JS/TS，61 文件，41 项）生成任务，最长函数 `startAnalysisView`（121 行）的摘录按头部 / 最深处 ±10 行 / 尾部截取，并标注省略范围；对照工作树校验为 valid。尚未在 AI Voice 等外部真实仓库上做“导出 → 编码 AI 修改 → 重分析”的完整案例，这是第一批验收的剩余项。

## 7. 未解决 / 待确认

1. **项目验证命令**：未自动探测（package.json scripts、pytest 配置等），只接受 `--command` 或调用方传入，其余列入 `toConfirm`。是否加入“探测到但需确认”的候选，需要产品决定。
2. **hub 任务**没有行级证据，只列模块文件，状态为 `unverifiable`，除非整体摘要可重算。是否要求 hub 规则提供代表性 import 行，待定。
3. **多选任务**：生成器支持多个 ID（顺序保留，`taskId` 与顺序无关）；UI 按计划先做单项。
4. **TS fixture**：契约 fixture 仅用 Python；TS 任务由自分析抽查覆盖，没有固定 fixture。
5. **规则版本**：`ruleVersions` 默认为 1；规则逻辑变化时，应在该规则模块导出 `version` 并递增，否则跨版本比较会误判为可比较（`analyzer.version` 变化仍会被识别）。

## 8. 改动文件

修改：`archify/bin/archify.mjs`（新增 `code-analysis task` 分派与用法）；模块内 `ARCHITECTURE.md`、`README.md`、`docs/USAGE.md`、`docs/TECH-GUIDE.md`、`bin/check.mjs`、`bin/serve.mjs`、`evaluate/index.mjs`、`lib/analysis.mjs`、`lib/review.mjs`、`overlay/overview.mjs`、`schemas/findings.schema.json`、`test/interactive.test.mjs`、`test/review.test.mjs`（断言文案 “fixed” → “no longer detected”）。

新增：`bin/task.mjs`、`lib/task.mjs`、`lib/evidence.mjs`、`schemas/ai-task.schema.json`、`test/task.test.mjs`、`test/comparability.test.mjs`、`test/task-fixtures.mjs`、`test/fixtures/py-tasks/**`、`test/fixtures/tasks/**`，以及本文档。
