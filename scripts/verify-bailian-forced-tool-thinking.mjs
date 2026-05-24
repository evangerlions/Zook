#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen3.6-plus";
const DEFAULT_TIMEOUT_MS = 60_000;

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const apiKey = process.env.BAILIAN_API_KEY ?? process.env.DASHSCOPE_API_KEY;
if (!apiKey) {
  console.error("Missing BAILIAN_API_KEY or DASHSCOPE_API_KEY.");
  console.error("Run with --help for usage.");
  process.exit(1);
}

const baseUrl = normalizeBaseUrl(process.env.BAILIAN_BASE_URL ?? DEFAULT_BASE_URL);
const model = process.env.BAILIAN_VERIFY_MODEL ?? process.env.BAILIAN_MODEL ?? DEFAULT_MODEL;
const timeoutMs = parsePositiveInteger(
  process.env.BAILIAN_VERIFY_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);

const forcedToolChoice = {
  type: "function",
  function: {
    name: "get_current_weather",
  },
};

const cases = [
  {
    name: "forced tool_choice + enable_thinking=true + non-stream",
    stream: false,
    enableThinking: true,
    toolChoice: forcedToolChoice,
    expectation: "restricted",
  },
  {
    name: "forced tool_choice + enable_thinking=false + non-stream",
    stream: false,
    enableThinking: false,
    toolChoice: forcedToolChoice,
    expectation: "tool_call",
  },
  {
    name: "forced tool_choice + enable_thinking=true + stream",
    stream: true,
    enableThinking: true,
    toolChoice: forcedToolChoice,
    expectation: "informational",
  },
  {
    name: "auto tool_choice + enable_thinking=true + stream",
    stream: true,
    enableThinking: true,
    toolChoice: "auto",
    expectation: "informational",
  },
];

console.log("Bailian forced function-call thinking verification");
console.log(`endpoint: ${baseUrl}/chat/completions`);
console.log(`model: ${model}`);
console.log("");

const results = [];
for (const testCase of cases) {
  const result = await runCase(testCase);
  results.push(result);
  printResult(result);
}

const baseline = results.find((result) =>
  result.name === "forced tool_choice + enable_thinking=false + non-stream"
);
if (!baseline?.returnedToolCall) {
  console.error(
    "\nBaseline failed: forced tool_choice with enable_thinking=false did not return tool_calls.",
  );
  process.exitCode = 1;
}

async function runCase(testCase) {
  const payload = buildPayload(testCase);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ...testCase,
        ok: false,
        status: response.status,
        response: await readJsonOrText(response),
      };
    }

    if (testCase.stream) {
      const streamSummary = await readSseSummary(response);
      return {
        ...testCase,
        ok: true,
        status: response.status,
        ...streamSummary,
      };
    }

    const responsePayload = await response.json();
    const message = responsePayload.choices?.[0]?.message;
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : [];

    return {
      ...testCase,
      ok: true,
      status: response.status,
      finishReason: responsePayload.choices?.[0]?.finish_reason,
      contentPreview: preview(message?.content),
      toolCalls: summarizeToolCalls(toolCalls),
      returnedToolCall: toolCalls.length > 0,
      responseId: responsePayload.id,
    };
  } catch (error) {
    return {
      ...testCase,
      ok: false,
      status: "transport_error",
      response: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPayload(testCase) {
  return {
    model,
    enable_thinking: testCase.enableThinking,
    stream: testCase.stream,
    messages: [
      {
        role: "system",
        content:
          "You are a function-calling test assistant. Use the provided tool when asked.",
      },
      {
        role: "user",
        content:
          "Call get_current_weather for Hangzhou using celsius. Return through the tool call.",
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "get_current_weather",
          description: "Return a tiny fake weather lookup payload for a city.",
          parameters: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "City name.",
              },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"],
              },
            },
            required: ["city", "unit"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: testCase.toolChoice,
  };
}

async function readJsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readSseSummary(response) {
  if (!response.body) {
    return {
      streamEvents: 0,
      streamToolDeltas: [],
      streamContentPreview: "",
      streamReasoningPreview: "",
      finishReason: undefined,
      returnedToolCall: false,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  let content = "";
  let reasoning = "";
  let finishReason;
  const toolDeltas = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice("data:".length).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        eventCount += 1;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const choice = parsed.choices?.[0];
        if (typeof choice?.delta?.content === "string") {
          content += choice.delta.content;
        }
        if (typeof choice?.delta?.reasoning_content === "string") {
          reasoning += choice.delta.reasoning_content;
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        for (const toolCall of choice?.delta?.tool_calls ?? []) {
          toolDeltas.push({
            index: toolCall.index,
            id: toolCall.id,
            name: toolCall.function?.name,
            argumentsPreview: preview(toolCall.function?.arguments),
          });
        }
      }
    }
  }

  return {
    streamEvents: eventCount,
    streamToolDeltas: toolDeltas.slice(0, 5),
    streamContentPreview: preview(content),
    streamReasoningPreview: preview(reasoning),
    finishReason,
    returnedToolCall: toolDeltas.length > 0,
  };
}

function printResult(result) {
  console.log(`== ${result.name}`);
  console.log(`status: ${result.status}`);
  console.log(`expectation: ${result.expectation}`);

  if (!result.ok) {
    console.log("verdict:", result.expectation === "restricted" ? "restricted/failure observed" : "failed");
    console.log("response:", JSON.stringify(result.response, null, 2));
    console.log("");
    return;
  }

  if (result.expectation === "restricted") {
    console.log(
      "verdict:",
      result.returnedToolCall
        ? "not restricted on this model/API path"
        : "no tool call returned despite HTTP 200",
    );
  } else if (result.expectation === "tool_call") {
    console.log("verdict:", result.returnedToolCall ? "tool call returned" : "missing tool call");
  } else {
    console.log("verdict:", result.returnedToolCall ? "tool call observed" : "no tool call observed");
  }

  if (result.finishReason) {
    console.log(`finishReason: ${result.finishReason}`);
  }
  if (result.responseId) {
    console.log(`responseId: ${result.responseId}`);
  }
  if (result.toolCalls) {
    console.log("toolCalls:", JSON.stringify(result.toolCalls, null, 2));
  }
  if (typeof result.streamEvents === "number") {
    console.log(`streamEvents: ${result.streamEvents}`);
    console.log("streamToolDeltas:", JSON.stringify(result.streamToolDeltas, null, 2));
  }
  if (result.contentPreview) {
    console.log(`contentPreview: ${result.contentPreview}`);
  }
  if (result.streamContentPreview) {
    console.log(`streamContentPreview: ${result.streamContentPreview}`);
  }
  if (result.streamReasoningPreview) {
    console.log(`streamReasoningPreview: ${result.streamReasoningPreview}`);
  }
  console.log("");
}

function summarizeToolCalls(toolCalls) {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: toolCall.type,
    name: toolCall.function?.name,
    argumentsPreview: preview(toolCall.function?.arguments),
  }));
}

function preview(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.length > 240 ? `${value.slice(0, 240)}...` : value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Usage:
  BAILIAN_API_KEY=sk-... node scripts/verify-bailian-forced-tool-thinking.mjs

Optional environment variables:
  BAILIAN_BASE_URL              Default: ${DEFAULT_BASE_URL}
  BAILIAN_VERIFY_MODEL          Default: ${DEFAULT_MODEL}
  BAILIAN_VERIFY_TIMEOUT_MS     Default: ${DEFAULT_TIMEOUT_MS}

What it checks:
  1. forced tool_choice + enable_thinking=true + non-stream
  2. forced tool_choice + enable_thinking=false + non-stream
  3. forced tool_choice + enable_thinking=true + stream
  4. auto tool_choice + enable_thinking=true + stream

The important comparison is case 1 vs case 2. Case 2 is the baseline Zook now
uses for mandatory structured AINovel jobs.`);
}
