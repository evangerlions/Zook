# 对话规划真实质量验收

状态：待真实 provider 与人工评审。不得用自动填分或测试替身关闭门禁。

输入使用 test/fixtures/lighttick-planning-quality-inputs.json 的 25 个固定案例（保留原 20 个边界案例，另加 5 个有效预算场景），执行时记录实际模板版本。先准备：

    node --experimental-transform-types scripts/lighttick-planning-quality.ts --out /tmp/quality-prepared

准备命令不联网、不调用 provider。执行真实评估时，使用新的空输出目录：

    node --experimental-transform-types scripts/lighttick-planning-quality.ts --config /private/path/provider.json --out /private/path/quality-run

配置 JSON 字段：baseUrl（HTTPS）、apiKey、provider、model；可提供 inputPerMillion、outputPerMillion、currency。文件留在本机私有目录，不提交，不把凭据贴进报告。费用按提供的费率与实际 promptTokens / completionTokens 估算；缺失费率或用量就记 unavailable，不能填 0 冒充免费。

脚本复用实际 LightTickAiRunner 和 OpenAI-compatible provider，使用隔离内存仓储，逐例保存原始输出、业务输出、fallback、延迟、usage、错误与费用。非法预算等案例可在 provider 前被拒绝；这些不计入 realProviderCases。原始 20 案例若不足 20 个真实输出，应补充有效案例继续评估，不把 pre-provider reject 或失败调用算成有效样本。报告使用新目录，避免覆盖人工评分。

人工评审填写每例 human.reviewer、reviewedAt 和五维 1–5 分：
- relevance：贴合目标和已知事实。
- actionability：任务能按时间预算实际执行。
- observable_outcome：可观察的完成结果。
- continuity：前后行动衔接，不重复已完成工作。
- recovery_fit：适应中断、低精力、预算变化。

不适用维度保持 null，并填写 naReasons。评分需结合案例 checks 和原始输出；适用均分至少 4，任何适用维度不得低于 3。预算/日期/所有权/确认边界等硬约束全部通过，且真实输出数量达到 20，才能提交人工验收结论。模型自动评价只能附加建议，不能冒充 human。

可用 --inputs /path/to/cases.json 指定补充案例集，仍须保留来源和检查项。不同运行的真实结果可由人工合并评审，不自动合并计数或评分。
