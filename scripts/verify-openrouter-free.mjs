import { OpenRouterOpenAICompatibleProvider } from "../src/services/openrouter-openai-compatible-provider.ts";

const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY;
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY or OPENROUTER_KEY.");
  process.exitCode = 1;
} else {
  const provider = new OpenRouterOpenAICompatibleProvider({ apiKey });
  const request = {
    model: {
      provider: "openrouter",
      modelKey: "openrouter-free",
      resolvedModelKey: "openrouter-free",
      providerModel: "openrouter/free",
    },
    messages: [{ role: "user", content: "Reply with OK only." }],
    maxTokens: 16,
  };

  try {
    const completion = await provider.complete(request);
    const events = [];
    for await (const event of provider.stream(request)) {
      events.push(event.type);
    }
    if (!events.includes("content_delta") || !events.includes("done")) {
      throw new Error("stream did not include content and done events");
    }
    console.log(JSON.stringify({
      status: "passed",
      provider: completion.provider,
      model: completion.providerModel,
      completionUsage: completion.usage,
      streamEventTypes: events,
    }));
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : undefined;
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
    console.error(JSON.stringify({ status: "failed", code, httpStatus: status }));
    process.exitCode = 1;
  }
}
