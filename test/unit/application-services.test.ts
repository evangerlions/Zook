import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("createApplication exposes worker services", async () => {
  const runtime = await createApplication();

  assert.equal(
    typeof runtime.services.failedEventRetryService.retryDueEvents,
    "function",
  );
  assert.equal(
    typeof runtime.services.smsVerificationCleanupService.runDailyCleanupIfDue,
    "function",
  );
  assert.equal(
    typeof runtime.services.notificationService.processQueueJob,
    "function",
  );
});
