import { createServer } from "node:http";

/**
 * 本地 OpenAI 兼容上游 mock（默认 127.0.0.1:8091）。
 *
 * 为什么需要它：本机 `zook_app_configs.common.llm_service` 把 bailian provider 指向
 * `http://127.0.0.1:8091/v1`（apiKey=mock-key），但该端口默认没有进程监听，于是
 * `lighttick.ai.run` 全部以 `LLM_PROVIDER_REQUEST_FAILED` 失败并走 facts_only 兜底。
 * 这个 mock 只负责把「模型成功返回」这一条链路打通，用于验证：
 *   worker -> LLM 调用 -> 输出校验 -> insights 落库 -> 复盘接口返回
 * 它不验证模型质量，也不代表真实 provider 可用。
 *
 * 场景判定依据是请求里的 OUTPUT_JSON_SCHEMA / 提示词特征，返回值必须能通过
 * Zook 侧校验（validateReviewOutput 要求 insights 为字符串数组，recommendations 按
 * 合同 oneOf[string, object] 两种都接受；courseDocument 要求课时条数与周次*频次一致、
 * 至少一个 review）。
 *
 * 覆盖场景：review（日/周/月复盘）、plan（AI 计划，含 steps）、coach、change_proposal、
 * learning_route（AI 课程大纲）、learning_lesson（AI 课时正文）、reading_guide（阅读中文导读）。
 *
 * 环境变量：
 *   LIGHTTICK_LLM_MOCK_PORT            监听端口，默认 8091
 *   LIGHTTICK_LLM_MOCK_MODE            ok（默认）| fail（一律 500，用于验证降级路径）
 *   LIGHTTICK_LLM_MOCK_RECOMMENDATIONS mixed（默认）| string | object
 *                                      复盘建议的返回形态。默认 mixed 最接近真实模型
 *                                      （会混着给字符串和对象），同时覆盖合同的两支。
 */

const port = Number(process.env.LIGHTTICK_LLM_MOCK_PORT ?? 8091);
const mode = process.env.LIGHTTICK_LLM_MOCK_MODE ?? "ok";
const recommendationShape = process.env.LIGHTTICK_LLM_MOCK_RECOMMENDATIONS ?? "mixed";
let requestCount = 0;

const STRING_RECOMMENDATIONS = [
  "下一周期只排 1 个必须完成的关键任务，降低同日多任务的切换成本。",
  "若某项任务连续两次跳过，先把它拆成 15 分钟以内的最小步骤再排期。",
];

const OBJECT_RECOMMENDATIONS = [
  {
    title: "下一周期只排 1 个必须完成的关键任务",
    detail: "同日多任务导致切换成本上升，先收敛到一件。",
    // action 在界面上按「做法：…」原样展示，所以这里给自然语言而不是内部代码
    action: "把下周的关键任务收敛到一件，其余降为可选项",
    evidence: { basis: "skipped_tasks", count: 1 },
  },
  {
    title: "连续两次跳过的任务先拆成 15 分钟最小步骤",
    detail: "未拆解的任务更容易被整体跳过。",
    action: "先拆出 15 分钟能做完的第一步，再排期",
    proposed_tasks: [{ title: "把任务拆成 15 分钟以内的第一步", estimated_minutes: 15 }],
  },
];

const REVIEW_RECOMMENDATIONS = {
  string: STRING_RECOMMENDATIONS,
  object: OBJECT_RECOMMENDATIONS,
  mixed: [STRING_RECOMMENDATIONS[0], OBJECT_RECOMMENDATIONS[1]],
};

const REVIEW_OUTPUT = {
  insights: [
    "本次窗口内有 1 个任务完成、1 个任务跳过，执行有真实落地。",
    "跳过发生在第二项任务，未看到对应的替代动作记录。",
  ],
  recommendations:
    REVIEW_RECOMMENDATIONS[recommendationShape] ?? REVIEW_RECOMMENDATIONS.mixed,
};

const COACH_OUTPUT = {
  message: "已看到你当前的计划与执行记录。建议先把今天唯一的关键任务做完，再决定是否加量。",
};

const LESSON_CONTENT = `## 引导问题
这次练习真正想解决的问题是什么？只写一句，不要展开。

## 概念
最小可行练习：先把动作做出来 10 分钟，再决定要不要加量。
开始的门槛越低，越容易拿到一次真实反馈。

## 示范
打开材料，设定 10 分钟计时，只做一个动作，结束后立刻写一行记录。

## 边界
不做超出 10 分钟的部分；状态差时只做开场那一步，也算完成。
不要在同一个时段里同时开两件事。

## 练习
用 10 分钟完成一次最小练习，并记录开始时间、结束时间与当时的感受。
---
## 参考分析
对照上面的记录，找出一个让你开始得更快的动作，以及一个拖慢你的动作。
把可复用的那条写成一句话。

## 自查
产出一段可回看的记录，且写明了下次怎么开始。
若记录里只有计划没有实际动作，本次练习不算完成。

## 记忆提示
先开始，再判断要不要加量。`;

function classify(prompt) {
  if (prompt.includes("Draft one complete lesson")) return "learning_lesson";
  if (prompt.includes("Draft a formal curriculum document")) return "learning_route";
  if (prompt.includes('"core_points"') && prompt.includes('"application_questions"')) return "reading_guide";
  if (prompt.includes('"insights"')) return "review";
  if (prompt.includes('"tasks"') && prompt.includes('"estimated_minutes"')) return "plan";
  if (prompt.includes('"diff"') && prompt.includes('"impact"')) return "change_proposal";
  return "coach";
}

/**
 * 导读输出故意固定声称 basis=full_text。
 * 这样只有摘要的文章在验收里能真正走到「服务端把依据纠正成 summary」这一步，
 * 而不是靠 mock 配合演一遍正确结果。language_notes 留空也是真实情况的一种（中文文章无需解释）。
 */
const READING_GUIDE_OUTPUT = {
  basis: "full_text",
  core_points: [
    "作者把「复习间隔」排在「总学习时长」之前，认为间隔安排不当会抵消时长投入。",
    "文章用一次小样本自测说明：分散复习的即时正确率更低，但一周后的保留率更高。",
    "作者提醒即时正确率不能作为学懂的依据，它只反映短期熟悉度。",
  ],
  evidence_limits: [
    "自测样本只有 12 人且都是在校学生，不能外推到其他人群。",
    "文章没有给出复习间隔的具体数值，只做了「分散优于集中」的方向性判断。",
  ],
  language_notes: [],
  application_questions: [
    "你最近一次复习是在学完之后多久？",
    "你判断「学懂了」的依据是即时正确率，还是过几天还能讲出来？",
  ],
};

/**
 * 课程大纲必须通过 courseDocument 校验：lessons.length 等于 weeks*sessions（self_paced 时等于
 * lesson_count）、number 连续、requires 只指向更早的课时、至少含一个 review。
 * 所以这里按 brief 里真实的周次/频次生成，而不是写死条数。
 */
function courseDocumentFor(prompt) {
  const weeks = Number((prompt.match(/"weeks"\s*:\s*(\d+)/) ?? [])[1] ?? 1);
  const sessions = Number((prompt.match(/"sessions"\s*:\s*(\d+)/) ?? [])[1] ?? 2);
  const perLesson = Number((prompt.match(/"minutes"\s*:\s*(\d+)/) ?? [])[1] ?? 30);
  const lessonCount = Number((prompt.match(/"lesson_count"\s*:\s*(\d+)/) ?? [])[1] ?? 0);
  const count = Math.max(2, Math.min(lessonCount || weeks * sessions, 364));
  const minutes = Math.max(5, Math.min(perLesson, 30));
  const lessons = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const isReview = number === count;
    return {
      number,
      topic: isReview ? "复盘与巩固" : `第 ${number} 次最小练习`,
      goal: isReview ? "回看全部练习记录并写出下一步" : "完成一次可检查的最小练习",
      exercise: isReview ? "逐条回看记录，标出一个可复用的做法" : "做 10 分钟并写一行记录",
      assessment: isReview ? "写出一条下次可直接执行的做法" : "存在一段可回看的记录",
      minutes,
      stage: 1,
      kind: isReview ? "review" : "lesson",
      requires: number > 1 ? [number - 1] : [],
    };
  });
  return {
    prerequisites: "能稳定每周投入一次 30 分钟的练习时间，并愿意记录结果。",
    stages: [{ title: "起步与稳定", goal: "先把动作做出来，再谈优化。" }],
    lessons,
  };
}

function bodyFor(kind, prompt = "") {
  if (kind === "reading_guide") return READING_GUIDE_OUTPUT;
  if (kind === "learning_route") return courseDocumentFor(prompt);
  // 课时正文校验要求 8 个教学小节齐全、练习与参考分析之间有一条独立分隔线，
  // 且引用的链接必须全部来自已审阅来源；这里不带任何 URL，因此不需要 sources。
  if (kind === "learning_lesson")
    return { content: LESSON_CONTENT, references: "本次课时未引用外部来源，只使用课程大纲中已确认的目标与练习设计。" };
  if (kind === "review") return REVIEW_OUTPUT;
  if (kind === "plan") {
    // 计划场景带上 scheduled_for 与 steps：steps 只有在 AI 提案落计划时才会被创建
    // （lighttick-plan.service.ts 按 output.tasks[].steps 建 step 行），
    // 手动计划没有步骤，所以「最小步骤」验收必须走 AI 计划这条路。
    const periodStart = (prompt.match(/"period_start"\s*:\s*"(\d{4}-\d{2}-\d{2})"/) ?? [])[1];
    return {
      summary: "mock 计划：只保留一个可执行的关键任务",
      assumptions: ["mock 上游，仅用于链路验证"],
      tasks: [
        {
          title: "完成一次 30 分钟的专注练习",
          estimated_minutes: 30,
          priority: 100,
          completion_criteria: "有可检查的产出",
          ...(periodStart ? { scheduled_for: periodStart } : {}),
          steps: ["打开材料，先做 10 分钟", "记录一个可检查的产出", "用一句话写下次要接着做什么"],
          guidance: { purpose: "先开始，再判断要不要加量", expected_output: "一段可回看的记录" },
        },
      ],
    };
  }
  if (kind === "change_proposal") return { diff: [], impact: { summary: "mock 上游无变更建议" } };
  return COACH_OUTPUT;
}

const server = createServer((request, response) => {
  const url = request.url ?? "/";

  if (request.method === "GET" && url.startsWith("/v1/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "list", data: [{ id: "kimi/kimi-k2.5", object: "model" }] }));
    return;
  }

  if (request.method !== "POST" || !url.startsWith("/v1/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `unsupported path ${url}` } }));
    return;
  }

  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    requestCount += 1;
    if (mode === "fail") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "mock upstream forced failure" } }));
      console.log(`[mock] #${requestCount} forced failure`);
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    // 用解析后的 content 判定场景：直接 stringify messages 会把引号转义，匹配不到 schema 键名。
    const prompt = (payload.messages ?? [])
      .map((message) => (typeof message?.content === "string" ? message.content : ""))
      .join("\n");
    const kind = classify(prompt);
    const content = JSON.stringify(bodyFor(kind, prompt));
    console.log(`[mock] #${requestCount} model=${payload.model ?? "unknown"} scene=${kind} chars=${raw.length}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: `mock-${requestCount}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: payload.model ?? "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1200, completion_tokens: 180, total_tokens: 1380 },
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock] openai-compatible upstream listening on http://127.0.0.1:${port}/v1 (mode=${mode})`);
});
