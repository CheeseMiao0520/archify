# MCO 的模型输出由谁解码，结果文件由谁写入

Archify 的 MCO 运行时架构案例把 provider 执行、答案解码和结果文件分成了不同组件。沿着源码看，职责还可以拆得更细：调用运行时负责调用适配器的解码方法，并写入流式答案文本；InvocationArtifactWriter 准备答案文件，再写出最终结果和元数据。解码器本身不负责文件写入。

本文解释已有的 MCO 运行时架构图，不代表重新执行了一次 agent 任务。查看原图：[MCO 运行时架构图](cases/mco-runtime.architecture.html)

<span class="section-anchor" id="case-version-boundary"></span>

## 先确认两个版本

图表的结构化源文件将 mco-org/mco 固定在 9f1a1cf1afdc04d7b5406782b40dfec76d9bc798。本文查看的 Archify 版本是 04dc1916e1651086564f16076eab6d2f6ba1ae42。它们属于不同仓库，不能混作一个版本。下文描述的是这个 MCO 快照，不是对其当前或未来 main 分支的保证。 [固定版本的图表源文件](https://github.com/tt-a1i/archify/blob/04dc1916e1651086564f16076eab6d2f6ba1ae42/docs/cases/mco-runtime.architecture.json#L1-L15)

<span class="section-anchor" id="case-decoding"></span>

## provider 输出如何变成答案

在所查看的调用路径中，invocation_runtime.py 读取 provider 的 stdout 日志。如果适配器提供可调用的 decode_transport 方法，运行时会调用 adapter.decode_transport(raw_output)，从返回的 deltas 提取流式文本；provider 报告 SUCCEEDED 后，再尝试取 transport.final_answer。此时如果解码抛出异常，或解码后的 transport.status 为 failed，这次调用仍会被判定失败。没有可调用的解码方法时，这条路径会退回原始输出。 [运行时解码处理](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L339-L409)

answer_transport.py 定义统一的 AnswerTransport 结构，包含 deltas、final_answer、status 和可选的 usage。文件中的解码函数分别处理纯文本、JSON 文本事件、Codex 事件、Pi 事件和 ACP 更新。它们把不同 provider 的输出转为统一表示，并不意味着所有 provider 使用相同的事件格式。 [答案传输结构](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/answer_transport.py)

<span class="section-anchor" id="case-file-writes"></span>

## 谁真正写文件

调用运行时创建 InvocationArtifactWriter，准备目录，并为每次调用创建答案文件路径。输出到来时，运行时会直接把解码后的文本增量追加到答案文件并刷新。因此，“只有 InvocationArtifactWriter 写答案文件”也不准确，流式追加发生在运行时里。 [答案文件准备](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L470-L477) · [流式写入](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L364-L390)

最终报告由 InvocationArtifactWriter 的报告写入方法负责。write_run 组装 result.md，并调用 _write_run_metadata 写出 run.json。元数据包含调用标识、provider、模型、状态、退出码、错误、输出路径，以及调用结果中已包含的 usage。在所查看的运行时中，只有启用 include_token_usage 且解码后的 transport.usage 非 null，usage 才会进入调用结果。这些字段记录结果，不证明答案正确，也不证明不同 provider 已达成共识。 [usage 纳入条件](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L303-L317) · [报告与元数据写入](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_artifacts.py#L31-L106)

<span class="section-anchor" id="case-persistence"></span>

## persist_artifacts 控制保留，不代表完全不落盘

在所查看的调用执行器中，persist_artifacts 决定使用保留目录还是 TemporaryDirectory。最终 write_run 调用受这个开关控制。关闭持久化时，返回结果里的 artifact_path 会清空，artifact_root 为 null，临时目录最后被清理。 [持久化目录选择](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L459-L477) · [调用清理](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L601-L630)

但关闭持久化不等于没有文件写入：执行器仍会准备临时答案文件。多阶段工作流也会在选定的根目录中写汇总报告；这个根目录可以是临时目录。关闭持久化时，工作流会清空对外返回的产物路径并执行清理。需要区分的是“保留产物”和“临时工作文件”。 [工作流目录](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L747-L758) · [汇总写入与清理](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L965-L993)

<span class="section-anchor" id="case-reading-the-arrow"></span>

## 图里的箭头应该怎么读

结构化源文件把 Answer Transport 连到 Invocation Artifacts。这条边表达的是架构层面的数据流：解码后的答案内容进入结果产物。它不是“解码器直接调用文件写入器”的逐函数调用关系。更准确的职责描述是：适配器接口提供解码，调用运行时组织执行并追加流式文本，产物写入器输出报告文件。 [运行时解码处理](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L339-L409) [答案文件准备](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L470-L477) · [流式写入](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L364-L390) [usage 纳入条件](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_runtime.py#L303-L317) · [报告与元数据写入](https://github.com/mco-org/mco/blob/9f1a1cf1afdc04d7b5406782b40dfec76d9bc798/runtime/invocation_artifacts.py#L31-L106) [图表定义的关系](https://github.com/tt-a1i/archify/blob/04dc1916e1651086564f16076eab6d2f6ba1ae42/docs/cases/mco-runtime.architecture.json#L228-L233)

这个案例适合回答一个具体的代码审查问题：“如果解析出来的文本不对，和保存出来的文件不对，分别应该先看哪里？”提取内容异常时，先查看解码行为；文件异常时，再看运行时写入、产物序列化和持久化设置。这些是排查入口，不是对某个已复现缺陷的诊断。

<span class="section-anchor" id="case-limits"></span>

## 这个案例能证明什么

已有的 Archify 产物把一个范围明确的运行时模型和固定版本的源码放在一起，方便读者逐项检查。它不证明生产部署、严格的时序调用栈、新 agent 任务执行成功、导出验收通过或性能提升。图中的动画轨迹展示的是作者定义的关系，不是采集到的运行时 trace。

安装和通用创作流程可直接查看已有指南，不必把这个案例当成新的安装教程：[Agent 画图指南](agent-diagrams.html)
