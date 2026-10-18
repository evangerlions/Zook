import { recordFrogSleepPushOutcome } from "./frogsleep-push-outcome.ts";
import { createHash } from "node:crypto";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { FrogSleepDeviceRecord, NotificationJobRecord } from "../shared/types.ts";
import type { PushDispatcher, PushNotificationPayload } from "./notification.service.ts";
import { frogSleepPushSuppression } from "./frogsleep-push-authorization.ts";
import { clearFrogSleepNotificationFailures, saveFrogSleepNotificationFailure } from "./frogsleep-notification-queue.ts";

type DeliveryState = { devices: Record<string, "provider_accepted" | "permanent_failed" | "processing" | "outcome_unknown">; outcome?: string };

/** Replays one durable job without resending device successes, under a cross-process session lock. */
export async function deliverFrogSleepPush(database: ApplicationDatabase, dispatcher: PushDispatcher, id: string) {
  await database.withFrogSleepNotificationLock(`job:${id}`, async () => {
    const value = await database.findNotificationJob(id);
    if (!value || value.appId !== "frogsleep" || value.channel !== "push" || value.status === "SENT") return;
    const record = structuredClone(value);
    await recoverInterruptedHandoff(database, record);
    if (record.retryCount >= 5) { await clearFrogSleepNotificationFailures(database, id); return; }
    record.retryCount += 1;
    try { await dispatchAttempt(database, dispatcher, record); }
    catch (error) {
      await database.updateNotificationJob(id, { status: "FAILED", retryCount: record.retryCount,
        payload: { ...record.payload, _frogsleep_delivery: { ...state(record), outcome: record.retryCount >= 5 ? "retry_exhausted" : "retryable_failed" } } });
      await recordFrogSleepPushOutcome(database, record, record.retryCount >= 5 ? "retry_exhausted" : "retryable_failed");
      if (record.retryCount < 5) await saveFrogSleepNotificationFailure(database, id, error);
      else await clearFrogSleepNotificationFailures(database, id);
    }
  });
}

async function dispatchAttempt(database: ApplicationDatabase, dispatcher: PushDispatcher, record: NotificationJobRecord) {
  const suppression = await frogSleepPushSuppression(database, record);
  if (suppression) { await finish(database, record, suppression); return; }
  const devices = await database.listFrogSleepDevices({ appId: record.appId, userId: record.recipientUserId, pushEnabled: true });
  if (!devices.length) { await finish(database, record, "NO_ACTIVE_DEVICES"); return; }
  let failure: unknown;
  for (const device of devices) {
    const revoked = await frogSleepPushSuppression(database, record);
    if (revoked) { await finish(database, record, revoked); return; }
    try { await dispatchDevice(database, dispatcher, record, device); }
    catch (error) { failure = error; }
  }
  if (failure) throw failure;
  const outcomes = Object.values(state(record).devices);
  await finish(database, record, outcomes.includes("outcome_unknown") ? "PROVIDER_OUTCOME_UNKNOWN"
    : outcomes.includes("permanent_failed") ? "PERMANENT_DEVICE_FAILURE" : "PROVIDER_ACCEPTED");
}

async function dispatchDevice(database: ApplicationDatabase, dispatcher: PushDispatcher, record: NotificationJobRecord, device: FrogSleepDeviceRecord) {
  const key = createHash("sha256").update(JSON.stringify([record.appId, record.recipientUserId, device.platform, device.pushToken])).digest("hex");
  const receipts = state(record);
  if (receipts.devices[key] === "processing") {
    receipts.devices[key] = "outcome_unknown";
    await saveReceipts(database, record, receipts); return;
  }
  if (receipts.devices[key]) return;
  const current = await database.listFrogSleepDevices({ appId: record.appId, userId: record.recipientUserId, pushEnabled: true });
  if (!current.some(value => value.id === device.id && value.pushToken === device.pushToken && value.platform === device.platform)) return;
  receipts.devices[key] = "processing";
  await saveReceipts(database, record, receipts);
  try { receipts.devices[key] = await sendToProvider(database, dispatcher, record, device); }
  catch (error) { delete receipts.devices[key]; await saveReceipts(database, record, receipts); throw error; }
  await saveReceipts(database, record, receipts);
}

async function sendToProvider(database: ApplicationDatabase, dispatcher: PushDispatcher, record: NotificationJobRecord, device: FrogSleepDeviceRecord) {
  let invalidated = false;
  try {
    await dispatcher.dispatch({ appId: record.appId, userId: record.recipientUserId, platform: device.platform,
      pushToken: device.pushToken, payload: record.payload as unknown as PushNotificationPayload,
      invalidateToken: async () => { invalidated = true; await database.deleteFrogSleepDevice(record.appId, record.recipientUserId, device.id); } });
    return invalidated ? "permanent_failed" as const : "provider_accepted" as const;
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    if (error instanceof TypeError || error instanceof SyntaxError || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "outcome_unknown" as const;
    if (status >= 400 && status < 500 && status !== 429) return "permanent_failed" as const;
    throw error;
  }
}

async function recoverInterruptedHandoff(database: ApplicationDatabase, record: NotificationJobRecord) {
  const receipts = state(record);
  const interrupted = Object.values(receipts.devices).includes("processing");
  if (!interrupted) return;
  for (const key of Object.keys(receipts.devices)) if (receipts.devices[key] === "processing") receipts.devices[key] = "outcome_unknown";
  await saveReceipts(database, record, receipts);
  if (record.retryCount >= 5) await finish(database, record, "PROVIDER_OUTCOME_UNKNOWN");
}

async function saveReceipts(database: ApplicationDatabase, record: NotificationJobRecord, receipts: DeliveryState) {
  record.payload = { ...record.payload, _frogsleep_delivery: receipts };
  await database.updateNotificationJob(record.id, { payload: record.payload, retryCount: record.retryCount });
}

function state(record: NotificationJobRecord): DeliveryState {
  const stored = record.payload._frogsleep_delivery as DeliveryState | undefined;
  return { ...stored, devices: { ...(stored?.devices ?? {}) } };
}

async function finish(database: ApplicationDatabase, record: NotificationJobRecord, outcome: string) {
  await database.updateNotificationJob(record.id, { status: "SENT", retryCount: record.retryCount,
    payload: { ...record.payload, _frogsleep_delivery: { ...state(record), outcome } } });
  await recordFrogSleepPushOutcome(database, record, outcome);
  await clearFrogSleepNotificationFailures(database, record.id);
}
