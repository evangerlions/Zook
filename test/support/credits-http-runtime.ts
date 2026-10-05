import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createApplication } from "./create-test-application.ts";
import type { LLMProvider } from "../../src/services/llm-manager.ts";

const keyId = "logk_d5872ff066b8450b9aeed1c53f0df7f1";
const key = Buffer.from("0123456789abcdef0123456789abcdef");

export function encryptCreditsFixture(payload: Record<string, unknown>) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
  return { encrypted: true, keyId, algorithm: "aes-256-gcm", nonceBase64: nonce.toString("base64"), ciphertextBase64: data.toString("base64") };
}

export function decodeCreditsFixture(envelope: Record<string, unknown>): Record<string, unknown> {
  if (!envelope.encrypted) return envelope;
  const data = Buffer.from(String(envelope.ciphertextBase64), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(envelope.nonceBase64), "base64"));
  decipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString());
}

/** Real HTTP/encryption/business routes; only upstream LLM and storage are deterministic doubles. */
export async function startCreditsHttpRuntime(port = 0) {
  let calls = 0;
  const observedModels: string[] = [];
  const provider: LLMProvider = {
    complete: async () => { throw Error("Fixture supports streaming only"); },
    async *stream(request) {
      calls++;
      observedModels.push(request.model.modelKey);
      const prompt = request.messages.at(-1)?.content ?? "";
      if (prompt === "fail") throw Error("Mock provider failure");
      yield { type: "content_delta", text: "已完成写作。" };
      if (prompt === "disconnect") {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1000);
          request.signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
        });
        if (request.signal?.aborted) return;
      }
      yield { type: "usage", usage: { promptTokens: prompt === "exhaust" ? 200_000 : 10_000, completionTokens: 1000, totalTokens: prompt === "exhaust" ? 201_000 : 11_000 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
  const runtime = await createApplication({ aiNovelCreditsEnabled: true, serviceName: "api", accessTokenSecret: "credits-http-fixture-only-secret-32-characters", logEncryptionKeys: { [keyId]: key.toString("base64") }, llmProviders: { bailian: provider } });
  await runtime.services.appRegistryService.ensureMembership("ai_novel", "user_alice");
  await runtime.services.commonLlmConfigService.updateConfig({ enabled: true, defaultModelKey: "qwen3.6-plus", providers: [{ key: "bailian", label: "Fixture", enabled: true, apiKey: "fixture-only", baseUrl: "https://fixture.invalid", timeoutMs: 1000 }], models: ["qwen3.6-plus", "manual-fixture"].map((modelKey) => ({ key: modelKey, label: modelKey, kind: "chat", strategy: "fixed", routes: [{ provider: "bailian", providerModel: modelKey, enabled: true, weight: 100 }] })) });
  await runtime.services.aiNovelModelPointPricingConfigService.updateConfig({ schemaVersion: 1, models: [{ modelKey: "qwen3.6-plus", inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 400 }, { modelKey: "manual-fixture", inputPointsPerMillionTokens: 200, cachedInputPointsPerMillionTokens: 20, outputPointsPerMillionTokens: 800 }] });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "ai_novel");
  const server = createServer(async (request, response) => {
    const cancellation = new AbortController();
    response.once("close", () => { if (!response.writableEnded) cancellation.abort(); });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
      const handled = await runtime.app.handle({ method: request.method ?? "GET", path: new URL(request.url ?? "/", "http://localhost").pathname, headers, body: body ? JSON.parse(body) : undefined, signal: cancellation.signal });
      response.writeHead(handled.statusCode, { "Content-Type": handled.contentType ?? "application/json", ...handled.headers });
      if (handled.streamBody) {
        for await (const chunk of handled.streamBody) { if (cancellation.signal.aborted) break; response.write(chunk); }
        response.end();
      } else response.end(JSON.stringify(handled.body));
    } catch {
      if (!response.destroyed) { response.statusCode = 500; response.end(JSON.stringify({ code: "FIXTURE_HTTP_ERROR" })); }
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("HTTP address missing");
  const url = `http://127.0.0.1:${address.port}`;
  return { runtime, url, token, calls: () => calls, observedModels: () => [...observedModels], close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
