import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmEmailAlertService } from "../../src/services/llm-email-alert.service.ts";

test("LLM alert emails once for a completed hour below 90% after more than 20 requests", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
  });
  const now = new Date("2030-01-01T10:12:00.000Z");

  assert.deepEqual(await service.runDueAlerts(now), { hourly: 1, circuits: 0 });
  assert.equal(sent.length, 1);
  assert.match(sent[0]?.subject ?? "", /hourly success rate/i);
  assert.match(sent[0]?.text ?? "", /85\.7%/);
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 0, circuits: 0 });
  assert.equal(sent.length, 1);
});

test("LLM alert emails once when a configured route is formally circuit-open", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const service = await createService({
    summary: { requestCount: 0, successCount: 0, failureCount: 0, timeoutCount: 0 },
    sent,
    circuitState: "open",
  });

  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 1 });
  assert.equal(sent.length, 1);
  assert.match(sent[0]?.subject ?? "", /circuit opened/i);
  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:13:00.000Z")), { hourly: 0, circuits: 0 });
});

test("LLM alert retries only a failed recipient without duplicating delivered recipients", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
    failFirstDelivery: true,
  });
  const now = new Date("2030-01-01T10:12:00.000Z");
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 0, circuits: 0 });
  assert.equal(sent.length, 0);
  assert.deepEqual(await service.runDueAlerts(now), { hourly: 1, circuits: 0 });
  assert.equal(sent.length, 1);
});

test("LLM alert ignores the 20-call boundary and isolates alert evaluation errors", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
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

test("LLM alert does nothing when SMTP environment is absent", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
    smtpConfigured: false,
  });
  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 0 });
  assert.equal(sent.length, 0);
});

test("LLM and AINovel feedback email paths can be disabled independently", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const service = await createService({
    summary: { requestCount: 21, successCount: 18, failureCount: 3, timeoutCount: 0 },
    sent,
    llmAlertEnabled: false,
    feedbackAlertEnabled: false,
  });
  assert.deepEqual(await service.runDueAlerts(new Date("2030-01-01T10:12:00.000Z")), { hourly: 0, circuits: 0 });
  await service.sendAiNovelFeedbackAlert({
    userId: "user-a",
    feedbackId: "feedback-disabled",
    message: "This feedback should not send an email while its toggle is disabled.",
    createdAt: "2030-01-01T01:00:00.000Z",
  });
  assert.equal(sent.length, 0);
});

test("AINovel feedback alert includes content and only notifies once per user per day", async () => {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
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
  assert.equal(sent.length, 3);
  assert.match(sent[0]?.text ?? "", /cursor after saving/);
  assert.doesNotMatch(sent[0]?.text ?? "", /user-a/);
});

async function createService(input: {
  summary: { requestCount: number; successCount: number; failureCount: number; timeoutCount: number };
  sent: Array<{ to: string; subject: string; text: string }>;
  circuitState?: "closed" | "open";
  failFirstDelivery?: boolean;
  throwMetrics?: boolean;
  smtpConfigured?: boolean;
  llmAlertEnabled?: boolean;
  feedbackAlertEnabled?: boolean;
}) {
  let deliveryAttempts = 0;
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
          emailAlerts: {
            llmEnabled: input.llmAlertEnabled !== false,
            aiNovelFeedbackEnabled: input.feedbackAlertEnabled !== false,
          },
          models: [{
            key: "model-a",
            kind: "chat",
            routes: [{ provider: "provider-a", providerModel: "upstream-a" }],
          }],
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
    { warn() {} } as never,
    {
      environment: input.smtpConfigured === false
        ? {}
        : {
            EMAIL_USERNAME: "alerts@163.com",
            EMAIL_PASSWORD: "smtp-password",
            EMAIL_TO_ADDRESS: "ops@example.com",
          },
      async sendMail(message) {
        deliveryAttempts += 1;
        if (input.failFirstDelivery && deliveryAttempts === 1) {
          throw new Error("SMTP unavailable");
        }
        input.sent.push({
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      },
    },
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
