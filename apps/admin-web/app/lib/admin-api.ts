import type {
  AdminBillingOrderDetail,
  AdminBillingOrderPage,
  AiNovelBillingOrderStatus,
  AdminAppSummary,
  AdminAiRoutingDocument,
  AdminAiNovelModelSelectionDocument,
  AdminAiNovelConversationRecordDocument,
  AdminAiNovelDebugTraceDocument,
  AdminAiNovelDebugTraceListDocument,
  AiNovelTraceKind,
  AiNovelTraceStatus,
  AiNovelModelSelectionConfig,
  AdminAppLogSecretRevealDocument,
  AdminAuthRateLimitDocument,
  AdminBootstrapResult,
  AdminConfigDocument,
  AdminContentSafetyBlockRecordsDocument,
  AdminContentSafetyDocument,
  AdminContentSafetyStatsDocument,
  AdminContentSafetyTestDocument,
  AdminEmailDeliveryEventListDocument, AdminFeedbackAttachmentContentDocument, AdminFeedbackListDocument, AdminFeedbackStatusUpdateDocument,
  AdminDeleteAppResult,
  AdminEmailServiceDocument,
  AdminEmailTestSendCommand,
  AdminEmailTestSendDocument,
  AdminGetuiGyCredentialRevealDocument,
  AdminGetuiGyServiceDocument,
  GetuiGyPlatform,
  GetuiGySensitiveCredentialField,
  AdminRemoteLogPullSettingsDocument,
  AdminRemoteLogPullTaskDocument,
  AdminRemoteLogPullTaskFileDocument,
  AdminRemoteLogPullTaskListDocument,
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmRouteCircuitResetDocument,
  AdminLlmRouteCircuitResetRequest,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestRunRequest,
  AdminPasswordDocument,
  AdminPasswordRevealDocument,
  AdminReleaseUpdateDocument,
  AdminSensitiveOperationCodeRequestDocument,
  AdminSmsServiceDocument,
  AdminSmsVerificationListDocument,
  AdminSmsVerificationRevealDocument,
  AdminSensitiveOperationGrantDocument,
  LlmMetricsRange,
  FeedbackStatus,
  BodyLogRange,
  BodyLogHabitTemplate,
} from "./types";
import { adminPath, requestBlob, requestJson } from "./admin-api-client.ts";

export {
  ADMIN_AUTH_REQUIRED_EVENT,
  ApiError,
  adminPath,
  isAdminAuthError,
  requestJson,
} from "./admin-api-client.ts";

function cleanQuery(query: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export const adminApi = {
  getLightTickOperations() { return requestJson<import("./types").LightTickAdminOperationsDocument>(adminPath("/apps/lighttick/operations")); },
  login(username: string, password: string) {
    return requestJson<AdminBootstrapResult & { sessionExpiresAt?: string }>(
      adminPath("/auth/login"),
      {
        method: "POST",
        body: { username, password },
      },
    );
  },
  logout() {
    return requestJson<{ loggedOut: true }>(adminPath("/auth/logout"), {
      method: "POST",
    });
  },
  bootstrap() {
    return requestJson<AdminBootstrapResult>(adminPath("/bootstrap"));
  },
  requestSensitiveOperationCode(operation: string) {
    return requestJson<AdminSensitiveOperationCodeRequestDocument>(
      adminPath("/sensitive-operations/request-code"),
      {
        method: "POST",
        body: { operation },
      },
    );
  },
  verifySensitiveOperationCode(operation: string, code: string) {
    return requestJson<AdminSensitiveOperationGrantDocument>(
      adminPath("/sensitive-operations/verify"),
      {
        method: "POST",
        body: { operation, code },
      },
    );
  },
  createApp(appId: string, appNameZhCn: string, appNameEnUs: string) {
    return requestJson<AdminAppSummary>(adminPath("/apps"), {
      method: "POST",
      body: { appId, appNameZhCn, appNameEnUs },
    });
  },
  updateAppNames(appId: string, appNameI18n: Record<string, string>) {
    return requestJson<AdminAppSummary>(adminPath(`/apps/${encodeURIComponent(appId)}/names`), {
      method: "PUT",
      body: { appNameI18n },
    });
  },
  revealAppLogSecret(appId: string) {
    return requestJson<AdminAppLogSecretRevealDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/log-secret/reveal`),
      {
        method: "POST",
      },
    );
  },
  deleteApp(appId: string) {
    return requestJson<AdminDeleteAppResult>(adminPath(`/apps/${encodeURIComponent(appId)}`), {
      method: "DELETE",
    });
  },
  getConfig(appId: string) {
    return requestJson<AdminConfigDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/config`));
  },
  getReleaseUpdates() {
    return requestJson<AdminReleaseUpdateDocument>(adminPath("/apps/common/release-updates"));
  },
  getReleaseUpdatesRevision(revision: number) {
    return requestJson<AdminReleaseUpdateDocument>(
      adminPath(`/apps/common/release-updates/revisions/${revision}`),
    );
  },
  updateReleaseUpdates(config: unknown, desc?: string) {
    return requestJson<AdminReleaseUpdateDocument>(adminPath("/apps/common/release-updates"), {
      method: "PUT",
      body: { config, desc: desc || undefined },
    });
  },
  restoreReleaseUpdates(revision: number, desc?: string) {
    return requestJson<AdminReleaseUpdateDocument>(
      adminPath(`/apps/common/release-updates/revisions/${revision}/restore`),
      { method: "POST", body: { desc: desc || undefined } },
    );
  },
  getAiRouting(appId: string) {
    return requestJson<AdminAiRoutingDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/ai-routing`));
  },
  getAiNovelModelSelection() {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath("/apps/ai_novel/model-selection"),
    );
  },
  getAiNovelModelSelectionRevision(revision: number) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath(`/apps/ai_novel/model-selection/revisions/${revision}`),
    );
  },
  updateAiNovelModelSelection(
    config: AiNovelModelSelectionConfig,
    desc?: string,
  ) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath("/apps/ai_novel/model-selection"),
      {
        method: "PUT",
        body: { config, desc: desc || undefined },
      },
    );
  },
  restoreAiNovelModelSelection(revision: number, desc?: string) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath(
        `/apps/ai_novel/model-selection/revisions/${revision}/restore`,
      ),
      {
        method: "POST",
        body: { desc: desc || undefined },
      },
    );
  },
  getAiRoutingRevision(appId: string, revision: number) {
    return requestJson<AdminAiRoutingDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/ai-routing/revisions/${revision}`),
    );
  },
  updateAiRouting(appId: string, rawJson: string, desc?: string) {
    return requestJson<AdminAiRoutingDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/ai-routing`), {
      method: "PUT",
      body: {
        rawJson,
        desc: desc || undefined,
      },
    });
  },
  restoreAiRouting(appId: string, revision: number, desc?: string) {
    return requestJson<AdminAiRoutingDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/ai-routing/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getConfigRevision(appId: string, revision: number) {
    return requestJson<AdminConfigDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/config/revisions/${revision}`),
    );
  },
  updateConfig(appId: string, rawJson: string, desc?: string) {
    return requestJson<AdminConfigDocument>(adminPath(`/apps/${encodeURIComponent(appId)}/config`), {
      method: "PUT",
      body: {
        rawJson,
        desc: desc || undefined,
      },
    });
  },
  restoreConfig(appId: string, revision: number, desc?: string) {
    return requestJson<AdminConfigDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/config/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getRemoteLogPull(appId: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull`),
    );
  },
  getRemoteLogPullRevision(appId: string, revision: number) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/revisions/${revision}`),
    );
  },
  updateRemoteLogPull(appId: string, config: unknown, desc?: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull`),
      {
        method: "PUT",
        body: {
          config,
          desc: desc || undefined,
        },
      },
    );
  },
  restoreRemoteLogPull(appId: string, revision: number, desc?: string) {
    return requestJson<AdminRemoteLogPullSettingsDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  listRemoteLogPullTasks(appId: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks`),
    );
  },
  createRemoteLogPullTask(appId: string, userId: string, did: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks`),
      {
        method: "POST",
        body: {
          userId,
          did,
        },
      },
    );
  },
  cancelRemoteLogPullTask(appId: string, taskId: string) {
    return requestJson<AdminRemoteLogPullTaskListDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks/${encodeURIComponent(taskId)}/cancel`),
      {
        method: "POST",
      },
    );
  },
  getRemoteLogPullTaskFile(appId: string, taskId: string) {
    return requestJson<AdminRemoteLogPullTaskFileDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks/${encodeURIComponent(taskId)}/file`),
    );
  },
  getRemoteLogPullTask(appId: string, taskId: string) {
    return requestJson<AdminRemoteLogPullTaskDocument>(
      adminPath(`/apps/${encodeURIComponent(appId)}/remote-log-pull/tasks/${encodeURIComponent(taskId)}`),
    );
  },
  getEmailService() {
    return requestJson<AdminEmailServiceDocument>(adminPath("/apps/common/email-service"));
  },
  getAuthRateLimits() {
    return requestJson<AdminAuthRateLimitDocument>(adminPath("/apps/common/auth-rate-limits"));
  },
  getAuthRateLimitsRevision(revision: number) {
    return requestJson<AdminAuthRateLimitDocument>(adminPath(`/apps/common/auth-rate-limits/revisions/${revision}`));
  },
  updateAuthRateLimits(input: Record<string, unknown>) {
    return requestJson<AdminAuthRateLimitDocument>(adminPath("/apps/common/auth-rate-limits"), {
      method: "PUT",
      body: input,
    });
  },
  restoreAuthRateLimits(revision: number, desc?: string) {
    return requestJson<AdminAuthRateLimitDocument>(
      adminPath(`/apps/common/auth-rate-limits/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getGetuiGyService() {
    return requestJson<AdminGetuiGyServiceDocument>(adminPath("/apps/common/getui-gy-service"));
  },
  getGetuiGyServiceRevision(revision: number) {
    return requestJson<AdminGetuiGyServiceDocument>(adminPath(`/apps/common/getui-gy-service/revisions/${revision}`));
  },
  updateGetuiGyService(input: Record<string, unknown>) {
    return requestJson<AdminGetuiGyServiceDocument>(adminPath("/apps/common/getui-gy-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreGetuiGyService(revision: number, desc?: string) {
    return requestJson<AdminGetuiGyServiceDocument>(
      adminPath(`/apps/common/getui-gy-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  revealGetuiGyCredentialValue(
    zookAppId: string,
    field: GetuiGySensitiveCredentialField,
    platform?: GetuiGyPlatform,
  ) {
    const path = platform
      ? `/apps/common/getui-gy-service/apps/${encodeURIComponent(zookAppId)}/platforms/${platform}/${field}/reveal`
      : `/apps/common/getui-gy-service/apps/${encodeURIComponent(zookAppId)}/${field}/reveal`;
    return requestJson<AdminGetuiGyCredentialRevealDocument>(
      adminPath(path),
      {
        method: "POST",
      },
    );
  },
  getEmailServiceRevision(revision: number) {
    return requestJson<AdminEmailServiceDocument>(adminPath(`/apps/common/email-service/revisions/${revision}`));
  },
  updateEmailService(input: Record<string, unknown>) {
    return requestJson<AdminEmailServiceDocument>(adminPath("/apps/common/email-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreEmailService(revision: number, desc?: string) {
    return requestJson<AdminEmailServiceDocument>(
      adminPath(`/apps/common/email-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  sendEmailTest(input: AdminEmailTestSendCommand) {
    return requestJson<AdminEmailTestSendDocument>(adminPath("/apps/common/email-service/test-send"), {
      method: "POST",
      body: input,
    });
  },
  getEmailDeliveryEvents(input: { event?: string; email?: string; limit?: number } = {}) {
    const query = new URLSearchParams(cleanQuery({
      event: input.event,
      email: input.email,
      limit: input.limit ? String(input.limit) : undefined,
    }));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<AdminEmailDeliveryEventListDocument>(adminPath(`/apps/common/email-service/events${suffix}`));
  },
  getAiNovelFeedback(input: { limit?: number; status?: FeedbackStatus | "all" } = {}) {
    const status = input.status && input.status !== "all" ? input.status : undefined;
    const query = new URLSearchParams(cleanQuery({ limit: input.limit ? String(input.limit) : undefined, status }));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<AdminFeedbackListDocument>(adminPath(`/apps/ai_novel/feedback${suffix}`));
  },
  getAiNovelBillingOrders(input: {
    userId?: string;
    paymentId?: string;
    providerTransactionId?: string;
    platform?: string;
    distribution?: string;
    status?: AiNovelBillingOrderStatus;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
    cursor?: string;
  } = {}) {
    const query = new URLSearchParams(cleanQuery({
      ...input,
      limit: input.limit === undefined ? undefined : String(input.limit),
    }));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<AdminBillingOrderPage>(adminPath(`/apps/ai_novel/billing/orders${suffix}`));
  },
  getAiNovelBillingOrder(paymentId: string, input: { eventsCursor?: string; eventsLimit?: number } = {}) {
    const query = new URLSearchParams(cleanQuery({
      eventsCursor: input.eventsCursor,
      eventsLimit: input.eventsLimit === undefined ? undefined : String(input.eventsLimit),
    }));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<AdminBillingOrderDetail>(adminPath(
      `/apps/ai_novel/billing/orders/${encodeURIComponent(paymentId)}${suffix}`,
    ));
  },
  getAiNovelConversationRecords(input: { uid?: string; did?: string; page?: number }) {
    const query = new URLSearchParams(cleanQuery({
      uid: input.uid,
      did: input.did,
      page: input.page === undefined ? undefined : String(input.page),
    }));
    return requestJson<AdminAiNovelConversationRecordDocument>(
      adminPath(`/apps/ai_novel/conversation-records?${query.toString()}`),
    );
  },
  getAiNovelDebugTraceSessions(input: {
    uid?: string;
    cid?: string;
    kind?: AiNovelTraceKind;
    status?: AiNovelTraceStatus;
    bookId?: string;
    chapterId?: string;
    query?: string;
  } = {}) {
    const query = new URLSearchParams(cleanQuery({
      uid: input.uid,
      cid: input.cid,
      kind: input.kind,
      status: input.status,
      bookId: input.bookId,
      chapterId: input.chapterId,
      query: input.query,
    }));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return requestJson<AdminAiNovelDebugTraceListDocument>(
      `/api/v1/ai_novel/debug/traces/data${suffix}`,
    );
  },
  getAiNovelDebugTraceSession(sessionId: string, kind: AiNovelTraceKind) {
    const query = new URLSearchParams({ kind });
    return requestJson<AdminAiNovelDebugTraceDocument>(
      `/api/v1/ai_novel/debug/traces/${encodeURIComponent(sessionId)}?${query.toString()}`,
    );
  },
  updateAiNovelFeedbackStatus(feedbackId: string, status: FeedbackStatus) {
    const path = `/apps/ai_novel/feedback/${encodeURIComponent(feedbackId)}/status`;
    return requestJson<AdminFeedbackStatusUpdateDocument>(adminPath(path), { method: "PATCH", body: { status } });
  },
  getAiNovelFeedbackAttachment(feedbackId: string, attachmentId: string) {
    const path = `/apps/ai_novel/feedback/${encodeURIComponent(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}`;
    return requestJson<AdminFeedbackAttachmentContentDocument>(adminPath(path));
  },
  getSmsService() {
    return requestJson<AdminSmsServiceDocument>(adminPath("/apps/common/sms-service"));
  },
  getSmsServiceRevision(revision: number) {
    return requestJson<AdminSmsServiceDocument>(adminPath(`/apps/common/sms-service/revisions/${revision}`));
  },
  updateSmsService(input: Record<string, unknown>) {
    return requestJson<AdminSmsServiceDocument>(adminPath("/apps/common/sms-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreSmsService(revision: number, desc?: string) {
    return requestJson<AdminSmsServiceDocument>(
      adminPath(`/apps/common/sms-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getPasswords() {
    return requestJson<AdminPasswordDocument>(adminPath("/apps/common/passwords"));
  },
  getSmsVerifications(appId?: string) {
    const suffix = appId ? `?appId=${encodeURIComponent(appId)}` : "";
    return requestJson<AdminSmsVerificationListDocument>(adminPath(`/apps/common/sms-verifications${suffix}`));
  },
  revealSmsVerification(recordId: string) {
    return requestJson<AdminSmsVerificationRevealDocument>(
      adminPath(`/apps/common/sms-verifications/${encodeURIComponent(recordId)}/reveal`),
      {
        method: "POST",
      },
    );
  },
  upsertPasswordItem(input: Record<string, unknown>) {
    return requestJson<AdminPasswordDocument>(adminPath("/apps/common/passwords/item"), {
      method: "PUT",
      body: input,
    });
  },
  deletePasswordItem(key: string) {
    return requestJson<AdminPasswordDocument>(adminPath(`/apps/common/passwords/${encodeURIComponent(key)}`), {
      method: "DELETE",
    });
  },
  revealPasswordValue(key: string) {
    return requestJson<AdminPasswordRevealDocument>(
      adminPath(`/apps/common/passwords/${encodeURIComponent(key)}/reveal`),
      {
        method: "POST",
      },
    );
  },
  getContentSafety() {
    return requestJson<AdminContentSafetyDocument>(adminPath("/apps/common/content-safety"));
  },
  getContentSafetyRevision(revision: number) {
    return requestJson<AdminContentSafetyDocument>(
      adminPath(`/apps/common/content-safety/revisions/${revision}`),
    );
  },
  updateContentSafety(input: Record<string, unknown>) {
    return requestJson<AdminContentSafetyDocument>(adminPath("/apps/common/content-safety"), {
      method: "PUT",
      body: input,
    });
  },
  testContentSafety(text: string) {
    return requestJson<AdminContentSafetyTestDocument>(adminPath("/apps/common/content-safety/test"), {
      method: "POST",
      body: {
        text,
      },
    });
  },
  listContentSafetyBlockRecords(query: Record<string, string | undefined>) {
    return requestJson<AdminContentSafetyBlockRecordsDocument>(
      adminPath(`/apps/common/content-safety/block-records?${new URLSearchParams(cleanQuery(query)).toString()}`),
    );
  },
  getContentSafetyStats(query: Record<string, string | undefined>) {
    return requestJson<AdminContentSafetyStatsDocument>(
      adminPath(`/apps/common/content-safety/stats?${new URLSearchParams(cleanQuery(query)).toString()}`),
    );
  },
  restoreContentSafety(revision: number, desc?: string) {
    return requestJson<AdminContentSafetyDocument>(
      adminPath(`/apps/common/content-safety/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getLlmService() {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"));
  },
  getLlmServiceRevision(revision: number) {
    return requestJson<AdminLlmServiceDocument>(adminPath(`/apps/common/llm-service/revisions/${revision}`));
  },
  updateLlmService(input: Record<string, unknown>) {
    return requestJson<AdminLlmServiceDocument>(adminPath("/apps/common/llm-service"), {
      method: "PUT",
      body: input,
    });
  },
  restoreLlmService(revision: number, desc?: string) {
    return requestJson<AdminLlmServiceDocument>(
      adminPath(`/apps/common/llm-service/revisions/${revision}/restore`),
      {
        method: "POST",
        body: {
          desc: desc || undefined,
        },
      },
    );
  },
  getLlmMetrics(range: LlmMetricsRange, filters: { provider?: string; providerModel?: string; operation?: "chat" | "embedding" } = {}) {
    const query = new URLSearchParams(cleanQuery({ range, ...filters }));
    return requestJson<AdminLlmMetricsDocument>(adminPath(`/apps/common/llm-service/metrics?${query.toString()}`));
  },
  resetLlmRouteCircuit(input: AdminLlmRouteCircuitResetRequest) {
    return requestJson<AdminLlmRouteCircuitResetDocument>(
      adminPath("/apps/common/llm-service/circuits/reset"),
      { method: "POST", body: input },
    );
  },
  getLlmModelMetrics(modelKey: string, range: LlmMetricsRange, provider?: string) {
    const query = new URLSearchParams(cleanQuery({ range, provider }));
    return requestJson<AdminLlmModelMetricsDocument>(
      adminPath(`/apps/common/llm-service/metrics/models/${encodeURIComponent(modelKey)}?${query.toString()}`),
    );
  },
  runLlmSmokeTest(input: AdminLlmSmokeTestRunRequest) {
    return requestJson<AdminLlmSmokeTestDocument>(adminPath("/apps/common/llm-service/smoke-test"), {
      method: "POST",
      body: input,
    });
  },
  getBodyLogCheckinDashboard(range: BodyLogRange = "30d") {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(`${to}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - days + 1);
    const from = fromDate.toISOString().slice(0, 10);
    return requestJson<import("./types").BodyLogCheckinDashboardDocument>(
      adminPath(`/apps/bodylog/checkin/dashboard?${new URLSearchParams({ range, from, to, timezone: "Asia/Shanghai" }).toString()}`),
    );
  },
  getBodyLogCheckinRecords(input: { query?: string; userId?: string; groupId?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
    return requestJson<import("./types").BodyLogCheckinRecordsDocument>(
      adminPath(`/apps/bodylog/checkin/records?${new URLSearchParams(cleanQuery({
        query: input.query,
        user_id: input.userId,
        group_id: input.groupId,
        from: input.from,
        to: input.to,
        page: input.page?.toString(),
        limit: input.limit?.toString(),
      })).toString()}`),
    );
  },
  exportBodyLogCheckinRecordsCsv(input: { userId?: string; groupId?: string; from?: string; to?: string } = {}) {
    return requestBlob(adminPath(`/apps/bodylog/checkin/records/export?${new URLSearchParams(cleanQuery({
      user_id: input.userId,
      group_id: input.groupId,
      from: input.from,
      to: input.to,
    })).toString()}`));
  },
  listBodyLogGroups(input: { status?: string; health?: string; from?: string; to?: string; page?: number; limit?: number } = {}) {
    return requestJson<import("./types").BodyLogGroupListDocument>(
      adminPath(`/apps/bodylog/groups?${new URLSearchParams(cleanQuery({
        status: input.status,
        health: input.health,
        from: input.from,
        to: input.to,
        page: input.page?.toString(),
        limit: input.limit?.toString(),
      })).toString()}`),
    );
  },
  getBodyLogGroupMemberContributions(groupId: string, input: { from?: string; to?: string } = {}) {
    return requestJson<{ items: import("./types").BodyLogGroupMember[] }>(
      adminPath(`/apps/bodylog/groups/${encodeURIComponent(groupId)}/members?${new URLSearchParams(cleanQuery(input)).toString()}`),
    );
  },
  listBodyLogHabitTemplates() {
    return requestJson<{ items: BodyLogHabitTemplate[] }>(adminPath("/apps/bodylog/habit-templates"));
  },
  createBodyLogHabitTemplate(input: Omit<BodyLogHabitTemplate, "id" | "appId" | "createdAt" | "updatedAt" | "status">) {
    return requestJson<{ item: BodyLogHabitTemplate }>(adminPath("/apps/bodylog/habit-templates"), { method: "POST", body: input });
  },
  updateBodyLogHabitTemplate(id: string, input: Partial<Omit<BodyLogHabitTemplate, "id" | "appId" | "createdAt" | "updatedAt">>) {
    return requestJson<{ item: BodyLogHabitTemplate }>(adminPath(`/apps/bodylog/habit-templates/${encodeURIComponent(id)}`), { method: "PUT", body: input });
  },
  deleteBodyLogHabitTemplate(id: string) {
    return requestJson<{ deleted: boolean; archived: boolean }>(adminPath(`/apps/bodylog/habit-templates/${encodeURIComponent(id)}`), { method: "DELETE" });
  },
  getBodyLogHabitTemplateUsage(input: { from?: string; to?: string } = {}) {
    return requestJson<import("./types").BodyLogHabitUsageDocument>(
      adminPath(`/apps/bodylog/habit-templates/usage?${new URLSearchParams(cleanQuery(input)).toString()}`),
    );
  },
};
