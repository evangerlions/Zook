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
