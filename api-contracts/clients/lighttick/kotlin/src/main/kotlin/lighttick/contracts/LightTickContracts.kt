package lighttick.contracts

data class LightTickEnvelope<T>(
    val code: String,
    val message: String,
    val data: T,
    val requestId: String,
)

enum class LightTickErrorCode {
    REQ_INVALID_BODY,
    REQ_FIELD_REQUIRED,
    REQ_FIELD_INVALID,
    AUTH_REQUIRED,
    AUTH_TOKEN_INVALID,
    AUTH_SESSION_REVOKED,
    APP_SCOPE_FORBIDDEN,
    APP_MEMBER_INACTIVE,
    LIGHTTICK_APP_DISABLED,
    LIGHTTICK_GUEST_SESSION_EXPIRED,
    LIGHTTICK_GUEST_UPGRADE_INVALID,
    LIGHTTICK_GUEST_CREDENTIAL_INVALID,
    LIGHTTICK_GUEST_EXPIRED,
    LIGHTTICK_GUEST_REVOKED,
    LIGHTTICK_GUEST_UPGRADE_CONFLICT,
    LIGHTTICK_ACCOUNT_ALREADY_UPGRADED,
    LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED,
    LIGHTTICK_REAUTH_REQUIRED,
    LIGHTTICK_APP_ACCESS_DENIED,
    LIGHTTICK_RESOURCE_NOT_FOUND,
    LIGHTTICK_STATE_TRANSITION_INVALID,
    LIGHTTICK_VERSION_CONFLICT,
    LIGHTTICK_IDEMPOTENCY_MISMATCH,
    LIGHTTICK_PLANNING_BUSY,
    LIGHTTICK_PLANNING_NOT_READY,
    LIGHTTICK_PLANNING_STALE,
    LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE,
    LIGHTTICK_PLAN_CONSTRAINT_FAILED,
    LIGHTTICK_AI_RUN_FAILED,
    LIGHTTICK_AI_UNAVAILABLE,
    LIGHTTICK_AI_QUOTA_EXCEEDED,
    LIGHTTICK_RUN_NOT_READY,
    LIGHTTICK_PROPOSAL_STALE,
    LIGHTTICK_PROPOSAL_NOT_PENDING,
    LIGHTTICK_SYNC_CURSOR_INVALID,
    LIGHTTICK_SYNC_BATCH_TOO_LARGE,
    LIGHTTICK_SYNC_OPERATION_REJECTED,
    LIGHTTICK_TIMEZONE_INVALID,
    RATE_LIMITED,
    INTERNAL_ERROR,
}

data class LightTickErrorData(
    val retryable: Boolean,
    val field: String? = null,
    val resourceId: String? = null,
    val currentVersion: Int? = null,
    val conflictFields: List<String>? = null,
    val resolutionActions: List<String>? = null,
    val retryAfterSeconds: Int? = null,
)

data class LightTickErrorEnvelope(
    val code: LightTickErrorCode,
    val message: String,
    val data: LightTickErrorData,
    val requestId: String,
)

enum class LightTickRuntimeEnvironment { local, dev, online }

enum class LightTickAccountKind { guest, registered }

data class LightTickPublicFeatureFlags(
    val guestSessions: Boolean,
    val accountUpgrade: Boolean,
    val sync: Boolean,
    val notifications: Boolean,
    val aiCoach: Boolean,
)

data class LightTickMinimumClientVersions(
    val ios: String,
    val android: String,
)

data class LightTickPublicConfigData(
    val appId: String,
    val enabled: Boolean,
    val environment: LightTickRuntimeEnvironment,
    val configurationVersion: String,
    val minimumClientVersions: LightTickMinimumClientVersions,
    val guestSessionTtlSeconds: Int,
    val features: LightTickPublicFeatureFlags,
    val privacyPolicyUrl: String,
    val termsOfServiceUrl: String,
    val supportUrl: String,
    val updatedAt: String,
)

data class LightTickGuestSessionData(
    val accountKind: LightTickAccountKind,
    val userId: String,
    val deviceId: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
    val guestExpiresAt: String,
    val upgradeToken: String,
)

data class LightTickAccountSessionData(
    val appId: String,
    val accountKind: LightTickAccountKind,
    val userId: String,
    val membershipStatus: String,
    val sessionExpiresAt: String,
    val guestExpiresAt: String? = null,
    val syncCursor: String? = null,
)

data class LightTickTransferredResourceCounts(
    val goals: Int,
    val plans: Int,
    val tasks: Int,
    val reviews: Int,
    val proposals: Int,
)

data class LightTickAccountUpgradeData(
    val accountKind: LightTickAccountKind,
    val userId: String,
    val previousGuestUserId: String,
    val guestSessionRevoked: Boolean,
    val idempotencyReplayed: Boolean,
    val syncCursor: String? = null,
    val transferredResourceCounts: LightTickTransferredResourceCounts,
)

data class LightTickAccountDeletionData(
    val appId: String,
    val membershipStatus: String,
    val sessionsRevoked: Boolean,
    val productDataDeleted: Boolean,
    val platformAccountRetained: Boolean,
    val otherMembershipsRetained: Boolean,
)

enum class LightTickSyncOperationStatus {
    accepted,
    duplicate,
    conflict,
    rejected,
    retryable,
}

enum class LightTickTaskVariant { standard, light, minimum }

enum class LightTickCommitmentMode { recovery, light, standard, sprint }

data class LightTickTaskVariantDefinition(
    val title: String,
    val estimatedDurationMinutes: Int,
    val completionCriteria: String,
)

data class LightTickStarterTask(
    val id: String,
    val lineageId: String,
    val title: String,
    val selectedVariant: LightTickTaskVariant,
    val estimatedDurationMinutes: Int,
    val variants: Map<LightTickTaskVariant, LightTickTaskVariantDefinition>,
    val version: Int,
)

data class LightTickStarterCandidate(
    val candidateId: String,
    val title: String,
    val assumption: String,
    val variants: Map<LightTickTaskVariant, LightTickTaskVariantDefinition>,
)

data class LightTickTaskStepData(
    val id: String,
    val title: String,
    val completed: Boolean,
    val position: Int,
)

data class LightTickTaskData(
    val id: String,
    val lineageId: String? = null,
    val planId: String,
    val title: String,
    val completionCriteria: String? = null,
    val selectedVariant: LightTickTaskVariant? = null,
    val variants: Map<LightTickTaskVariant, LightTickTaskVariantDefinition>? = null,
    val status: String,
    val scheduledDate: String,
    val estimatedDurationMinutes: Int,
    val actualDurationMinutes: Int? = null,
    val priority: Int,
    val steps: List<LightTickTaskStepData>,
    val note: String? = null,
    val version: Int,
)

data class LightTickTodayData(
    val businessDate: String,
    val timezone: String,
    val primaryTask: LightTickTaskData? = null,
    val tasks: List<LightTickTaskData>,
    val completedTasks: List<LightTickTaskData>,
    val remainingEstimatedMinutes: Int,
    val planBAvailable: Boolean,
    val snapshotVersion: Int,
)

data class LightTickSyncOperationResult(
    val operationId: String,
    val status: LightTickSyncOperationStatus,
    val entityType: String? = null,
    val entityId: String? = null,
    val version: Int? = null,
    val conflictFields: List<String>? = null,
    val resolutionActions: List<String>? = null,
    val errorCode: LightTickErrorCode? = null,
)

data class LightTickSyncPushData(
    val results: List<LightTickSyncOperationResult>,
    val serverTime: String,
)


/** GET /api/v1/lighttick/onboarding/commitment (account-scoped, read-only). */
data class LightTickCommitmentState(
    val commitmentMode: String?,
    val validActionCount: Int,
    val requiredActionCount: Int,
    val eligible: Boolean,
)

// BEGIN GENERATED PLANNING SESSION

sealed interface PlanningScalar {
    data class Text(val value: String): PlanningScalar
    data class Minutes(val value: Int): PlanningScalar
}
data class PlanningValue(val value: PlanningScalar, val source: String, val source_message_id: String? = null)
data class PlanningSession(

    val id: String,
    val goal_id: String,
    val thread_id: String,
    val status: String,
    val version: Int,
    val context_revision: Int,
    val context: Map<String, PlanningValue>,
    val questions: List<String>,
    val clarification_rounds: Int,
    val active_run_id: String?,
    val draft_plan_id: String?,
    val draft_revision: Int?,
    val draft_expires_at: String?,
    val last_error: String?,
    val can_generate: Boolean,
    val created_at: String,
    val updated_at: String,
)
// END GENERATED PLANNING SESSION

// Shared action workspace. Generated by build_scripts/generate_action_clients.py.
data class LightTickActionTarget(
    val kind: String,
    val course: String? = null,
    val plan_id: String? = null,
    val lesson_no: Int? = null,
)
data class LightTickActionProgress(
    val minutes: Int,
    val completed: Int,
    val minimum: Int,
    val interrupted: Int,
    val partial: Int,
)
data class LightTickActionCapabilities(
    val nullable_schedule: Boolean,
    val completion_modes: List<String>,
    val content_receipts: List<String>,
    val actual_fact_dates: Boolean,
    val connection_write_enabled: Boolean,
    val source_delivery_enabled: Boolean,
    val v2_import_enabled: Boolean,
)
data class LightTickActionPlan(
    val title: String,
    val period: String,
    val horizon: String,
    val start_date: String? = null,
    val end_date: String? = null,
    val timezone: String,
    val parent_id: String? = null,
    val target_minutes: Int? = null,
    val minimum_minutes: Int? = null,
    val target_count: Int,
    val at: String? = null,
    val reminder: Boolean,
    val reason: String,
    val if_then: String,
    val target: LightTickActionTarget? = null,
    val completion_mode: String,
    val estimated_minutes: Int? = null,
    val id: String,
    val revision: Int,
    val status: String,
    val created_at: String,
    val updated_at: String,
    val reminder_at: String? = null,
    val progress: LightTickActionProgress? = null,
    val blocked: Boolean? = null,
    val schema_version: Int,
    val completed_at: String? = null,
    val completion_record_id: String? = null,
)
data class LightTickActionExecution(
    val id: String,
    val plan_id: String,
    val title: String,
    val started_at: String,
    val ended_at: String? = null,
    val variant: String,
    val planned_minutes: Int? = null,
    val actual_minutes: Int,
    val outcome: String,
    val note: String,
    val business_date: String,
    val timezone: String,
    val target: LightTickActionTarget? = null,
    val schema_version: Int,
    val record_kind: String,
    val completion_mode: String,
    val completion_effect: String,
    val planned_date: String? = null,
    val date_basis: String,
    val reverses_record_id: String? = null,
    val source_event_id: String? = null,
    val recorded_at: String? = null,
)
data class LightTickActionWorkspace(
    val plans: List<LightTickActionPlan>,
    val execution: LightTickActionExecution? = null,
    val server_time: String,
    val workspace_version: Int,
    val reminder_delivery: String,
    val action_schema_version: Int,
    val capabilities: LightTickActionCapabilities,
)
data class LightTickLearningStageProgress(
    val number: Int,
    val title: String,
    val total_lessons: Int,
    val published_lessons: Int,
    val completed_lessons: Int,
    val percent: Int,
)
data class LightTickLearningPlanProgress(
    val id: String,
    val name: String,
    val version: Int,
    val status: String,
    val total_lessons: Int,
    val published_lessons: Int,
    val completed_lessons: Int,
    val percent: Int,
    val stages: List<LightTickLearningStageProgress>,
)
data class LightTickLearningProgress(
    val source_revision: Int,
    val observed_at: String,
    val received_at: String,
    val web_url: String,
    val plans: List<LightTickLearningPlanProgress>,
)
data class LightTickLearningProgressData(
    val progress: LightTickLearningProgress? = null,
)
data class LightTickLearningLessonSummary(
    val id: String,
    val collection_id: String,
    val collection_title: String,
    val number: Int,
    val title: String,
    val content_version: String,
    val learning_state: String,
    val source_url: String,
)
data class LightTickLearningLesson(
    val id: String,
    val collection_id: String,
    val collection_title: String,
    val number: Int,
    val title: String,
    val content_version: String,
    val learning_state: String,
    val source_url: String,
    val content: String,
    val references: String,
)
data class LightTickLearningLibraryData(
    val consent_enabled: Boolean,
    val binding_id: String? = null,
    val observed_at: String? = null,
    val lessons: List<LightTickLearningLessonSummary>,
)
data class LightTickLearningLessonData(
    val lesson: LightTickLearningLesson,
    val binding_id: String,
    val observed_at: String,
)
data class LightTickLearningAnswer(
    val id: String,
    val prompt: String,
    val answer: String,
)
data class LightTickLearningPrivateState(
    val id: String,
    val content_version: String,
    val draft_version: String,
    val revision: Int,
    val notes: String,
    val answers: List<LightTickLearningAnswer>,
    val completed: Boolean,
    val completed_at: String? = null,
    val position: Int,
    val updated_at: String,
)
data class LightTickLearningPrivateOperation(
    val id: String,
    val status: String,
    val error: String,
)
data class LightTickLearningPrivateData(
    val enabled: Boolean,
    val state: LightTickLearningPrivateState? = null,
    val operations: List<LightTickLearningPrivateOperation>,
)
data class LightTickLearningPrivateCommand(
    val id: String,
    val content_version: String,
    val revision: Int,
    val action: String,
    val notes: String,
    val answers: List<LightTickLearningAnswer>,
    val position: Int,
)

// Independent records: dates are calendar dates, versions protect every mutation.
data class LightTickRecordSource(val instance:String,val id:String,val imported_at:String,val missing_versions:List<Int>)
data class LightTickRecord(
    val id: String,
    val raw_text: String,
    val record_date: String,
    val prompt_kind: String = "free",
    val guided_answers: Map<String, String> = emptyMap(),
    val tags: List<String> = emptyList(),
    val adopted_summary: String? = null,
    val summary_basis_version: Int? = null,
    val archived_at: String? = null,
    val version: Int,
    val created_at: String,
    val updated_at: String,
    val source:LightTickRecordSource? = null
)
data class LightTickRecordPage(val items: List<LightTickRecord>, val has_more: Boolean, val next_cursor: String? = null)
data class LightTickRecordVersions(val items: List<LightTickRecord>)
