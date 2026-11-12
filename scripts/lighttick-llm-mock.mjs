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
 * Zook 侧校验（validateReviewOutput 要求 insights 与 recommendations 均为字符串数组）。
 *
 * 环境变量：
 *   LIGHTTICK_LLM_MOCK_PORT  监听端口，默认 8091
 *   LIGHTTICK_LLM_MOCK_MODE  ok（默认）| fail（一律 500，用于验证降级路径）
 */

const port = Number(process.env.LIGHTTICK_LLM_MOCK_PORT ?? 8091);
const mode = process.env.LIGHTTICK_LLM_MOCK_MODE ?? "ok";
let requestCount = 0;

const REVIEW_OUTPUT = {
  insights: [
    "本次窗口内有 1 个任务完成、1 个任务跳过，执行有真实落地。",
    "跳过发生在第二项任务，未看到对应的替代动作记录。",
  ],
  recommendations: [
    "下一周期只排 1 个必须完成的关键任务，降低同日多任务的切换成本。",
    "若某项任务连续两次跳过，先把它拆成 15 分钟以内的最小步骤再排期。",
  ],
};

const COACH_OUTPUT = {
  message: "已看到你当前的计划与执行记录。建议先把今天唯一的关键任务做完，再决定是否加量。",
};

function classify(prompt) {
  if (prompt.includes('"insights"')) return "review";
  if (prompt.includes('"tasks"') && prompt.includes('"estimated_minutes"')) return "plan";
  if (prompt.includes('"diff"') && prompt.includes('"impact"')) return "change_proposal";
  return "coach";
}

function bodyFor(kind) {
  if (kind === "review") return REVIEW_OUTPUT;
  if (kind === "plan") {
    return {
      summary: "mock 计划：只保留一个可执行的关键任务",
      assumptions: ["mock 上游，仅用于链路验证"],
      tasks: [
        {
          title: "完成一次 30 分钟的专注练习",
          estimated_minutes: 30,
          priority: 100,
          completion_criteria: "有可检查的产出",
          guidance: "先做 10 分钟，再决定是否继续",
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
    const content = JSON.stringify(bodyFor(kind));
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
