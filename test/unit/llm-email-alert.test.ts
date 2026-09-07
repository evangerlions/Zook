import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmEmailAlertService } from "../../src/services/llm-email-alert.service.ts";

test("LLM alert emails once for a completed hour below 90% after more than 20 requests", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
  });
  const now = new Date("2030-01-01T10:12:00.000Z");

  assert.deepEqual(await service.runDueAlerts(now), { hourly: 1, circuits: 0 });
  assert.equal(sent.length, 2);
  assert.match(sent[0]?.subject ?? "", /hourly success rate/i);
  assert.match(String(sent[0]?.templateData.summary), /85\.7%/);
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 0, circuits: 0 });
  assert.equal(sent.length, 2);
});

test("LLM alert emails once when a configured route is formally circuit-open", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const service = await createService({
    summary: { requestCount: 0, successCount: 0, failureCount: 0, timeoutCount: 0 },
    sent,
    circuitState: "open",
  });

  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 1 });
  assert.equal(sent.length, 2);
  assert.match(sent[0]?.subject ?? "", /circuit opened/i);
  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:13:00.000Z")), { hourly: 0, circuits: 0 });
});

test("LLM alert retries only a failed recipient without duplicating delivered recipients", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
    failFirstDelivery: true,
  });
  const now = new Date("2030-01-01T10:12:00.000Z");
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 1, circuits: 0 });
  assert.equal(sent.length, 1);
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 1, circuits: 0 });
  assert.equal(sent.length, 2);
});

test("LLM alert ignores the 20-call boundary and isolates alert evaluation errors", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const atThreshold = await createService({
    summary: { requestCount: 20, successCount: 0, failureCount: 20, timeoutCount: 0 },
    sent,
  });
  assert.deepEqual(await atThreshold.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 0 });
  const failingMetrics = await createService({
    summary: { requestCount: 0, successCount: 0, failureCount: 0, timeoutCount: 0 },
    sent,
    throwMetrics: true,
  });
  assert.deepEqual(await failingMetrics.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 0 });
});

test("LLM alert does nothing when no recipients are configured", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
    recipients: [],
  });
  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 0 });
  assert.equal(sent.length, 0);
});

test("AINovel feedback alert includes content and only notifies once per user per day", async () => {
  const sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }> = [];
  const service = await createService({
    summary: { requestCount: 0, successCount: 0, failureCount: 0, timeoutCount: 0 },
    sent,
  });
  await service.sendAiNovelFeedbackAlert({
    userId: "user-a",
    feedbackId: "feedback-1",
    message: "The chapter editor loses my cursor after saving a draft.",
    createdAt: "2030-01-01T01:00:00.000Z",
  });
  await service.sendAiNovelFeedbackAlert({
    userId: "user-a",
    feedbackId: "feedback-2",
    message: "This second feedback should not create another daily email.",
    createdAt: "2030-01-01T12:00:00.000Z",
  });
  await service.sendAiNovelFeedbackAlert({
    userId: "user-b",
    feedbackId: "feedback-3",
    message: "A different user should be able to notify the same day.",
    createdAt: "2030-01-01T12:00:00.000Z",
  });
  await service.sendAiNovelFeedbackAlert({
    userId: "user-a",
    feedbackId: "feedback-4",
    message: "The same user may notify again after the next Asia Shanghai calendar day begins.",
    createdAt: "2030-01-01T16:01:00.000Z",
  });
  assert.equal(sent.length, 6);
  assert.match(String(sent[0]?.templateData.details), /cursor after saving/);
  assert.doesNotMatch(String(sent[0]?.templateData.summary), /user-a/);
});

async function createService(input: {
  summary: { requestCount: number; successCount: number; failureCount: number; timeoutCount: number };
  sent: Array<{ email: string; subject: string; templateData: Record<string, unknown> }>;
  circuitState?: "closed" | "open";
  failFirstDelivery?: boolean;
  throwMetrics?: boolean;
  recipients?: string[];
}) {
  let deliveryAttempts = 0;
  const recipients = input.recipients ?? ["ops@example.com", "oncall@example.com"];
  return new LlmEmailAlertService(
    {
      async queryMetrics() {
        if (input.throwMetrics) throw new Error("metrics unavailable");
        return {
          summary: {
            ...emptyAggregate(),
            ...input.summary,
          },
        };
      },
    } as never,
    await KVManager.create({ backend: new InMemoryKVBackend() }),
    {
      async getRuntimeConfig() {
        return {
          enabled: true,
          routeCircuitBreaker: { enabled: true },
          models: [{
            key: "model-a",
            kind: "chat",
            routes: [{ provider: "provider-a", providerModel: "upstream-a" }],
          }],
        };
      },
    } as never,
    {
      async getDocument() {
        return { config: { enabled: true, llmAlertRecipients: recipients } };
      },
      async getRuntimeConfig() {
        return {
          config: { llmAlertRecipients: recipients },
          resolvedRegion: "ap-guangzhou",
          sender: { address: "noreply@example.com" },
          template: { templateId: 123 },
        };
      },
    } as never,
    {
      async getRuntimeStatus() {
        return {
          enabled: true,
          state: input.circuitState ?? "closed",
          failureCount: 4,
          distinctUserCount: 2,
          openedAt: "2030-01-01T10:00:00.000Z",
          nextRecoveryAt: "2030-01-01T10:05:00.000Z",
          recoverySuccessCount: 0,
          recoveryFailureCount: 0,
        };
      },
    } as never,
    {
      async sendTemplateEmail(command) {
        deliveryAttempts += 1;
        if (input.failFirstDelivery && deliveryAttempts === 1) {
          throw new Error("SES unavailable");
        }
        input.sent.push({
          email: command.email,
          subject: command.subject,
          templateData: command.templateData,
        });
        return { provider: "tencent_ses" };
      },
    } as never,
    { warn() {} } as never,
  );
}

function emptyAggregate() {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    cancelledCount: 0,
    latencySampleCount: 0,
    firstResponseSampleCount: 0,
    providerUsageCount: 0,
    estimatedUsageCount: 0,
    missingUsageCount: 0,
  };
}
