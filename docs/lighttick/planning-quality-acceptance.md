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

## 学习执行 A3

学习执行质量由 `scripts/lighttick-learning-execution-quality.ts` 单独评估。它从固定样本和材料构建隔离账号，调用实际 LearningWork。已有课程样本复用版本化课程并只生成排期建议，其余样本依次生成大纲、首课和排期建议。验证可以保存排期预览，且任何一次模型响应都不直接创建任务。每次尝试保留配置修订、模型、提示与结构版本、材料摘要、延迟、返回用量和估算费用。评审报告单独保留人工结论。

默认的 `--mode prepare` 不联网，也不读取模型凭证。 `--mode preflight` 从给定环境的现有 Zook 配置及密码存储读取，不修改配置。不调用模型，检查路由能否用于批量评测及费率是否覆盖全程。 `--mode run` 在同一预检通过后执行。评测会固定一个现有直连路由，每阶段只调用一次。现有四个课程样本各需一次调用，另外二十个样本各需三次。全量共最多 64 次调用，按 Zook 场景上限加总为 10.40 美元。实际评测需核对固定路由的费率、可用额度和本轮上限。

```sh
node --experimental-transform-types scripts/lighttick-learning-execution-quality.ts \
  --mode preflight --out /private/path/a3-preflight \
  --env-file /private/path/zook-existing.env --model novel-structured \
  --provider existing-provider --rates /private/path/rates.json \
  --ceiling-usd BUDGET --medical-review /private/path/material-review.json
```

费率文件含 `provider`、`model`（上游模型名）、`input_usd_per_million`、`output_usd_per_million`、`source`（已核对的报价链接），价格按可用区间的无缓存最高费率填写。四个医疗素养样本的来源和范围另行审核，审核文件是含 `case_id`、`reviewer`、`reviewed_at`、`source_sha256` 的数组。材料摘要见准备报告。未审核的医疗素养样本保留待验。评审按 A3 检查项逐例验收，24 个真实结果齐备后仍需人工结论。

2026-11-19，本机默认配置是 Mock。另一份已有配置的可用凭证绑定百炼 Coding Plan，阿里云将自动脚本及应用后端排除在其适用范围外。已在现有两份配置上复现预检阻塞。实际调用为 0，真实验收保持待办。[阿里云 Coding Plan 使用规则](https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq)

独立本地 Zook 已接入百炼按量北京路由，固定 `qwen3.7-plus`。按人民币 5 元上限预检，64 次调用的保守估算为 4.557568 元。四份医疗素养材料已逐项核对公开来源和练习范围。首次样本请求全部失败，24 次请求未返回生成用量，随后在同一端点的模型列表接口确认 HTTP 401、`invalid_api_key`。本地凭证带有套餐 Key 前缀，真实结果仍为 0/24。评测现会在按量路由上预先拒绝套餐 Key，并在真实上游返回 HTTP 401 时终止全批。[百炼模型定价](https://help.aliyun.com/zh/model-studio/qwen3-7-plus) · [百炼鉴权错误说明](https://help.aliyun.com/zh/model-studio/error-code)
