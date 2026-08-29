import Foundation

public struct LightTickEnvelope<Data: Codable & Sendable>: Codable, Sendable {
    public let code: String
    public let message: String
    public let data: Data
    public let requestId: String
}

public enum LightTickErrorCode: String, Codable, Sendable {
    case invalidBody = "REQ_INVALID_BODY"
    case requiredField = "REQ_FIELD_REQUIRED"
    case invalidField = "REQ_FIELD_INVALID"
    case authRequired = "AUTH_REQUIRED"
    case invalidToken = "AUTH_TOKEN_INVALID"
    case sessionRevoked = "AUTH_SESSION_REVOKED"
    case appScopeForbidden = "APP_SCOPE_FORBIDDEN"
    case inactiveMember = "APP_MEMBER_INACTIVE"
    case appDisabled = "LIGHTTICK_APP_DISABLED"
    case guestSessionExpired = "LIGHTTICK_GUEST_SESSION_EXPIRED"
    case guestUpgradeInvalid = "LIGHTTICK_GUEST_UPGRADE_INVALID"
    case guestUpgradeConflict = "LIGHTTICK_GUEST_UPGRADE_CONFLICT"
    case accountAlreadyUpgraded = "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED"
    case accountDeletionReauthenticationRequired = "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED"
    case resourceNotFound = "LIGHTTICK_RESOURCE_NOT_FOUND"
    case invalidStateTransition = "LIGHTTICK_STATE_TRANSITION_INVALID"
    case versionConflict = "LIGHTTICK_VERSION_CONFLICT"
    case idempotencyMismatch = "LIGHTTICK_IDEMPOTENCY_MISMATCH"
    case planConstraintFailed = "LIGHTTICK_PLAN_CONSTRAINT_FAILED"
    case aiRunFailed = "LIGHTTICK_AI_RUN_FAILED"
    case aiUnavailable = "LIGHTTICK_AI_UNAVAILABLE"
    case aiQuotaExceeded = "LIGHTTICK_AI_QUOTA_EXCEEDED"
    case runNotReady = "LIGHTTICK_RUN_NOT_READY"
    case proposalStale = "LIGHTTICK_PROPOSAL_STALE"
    case proposalNotPending = "LIGHTTICK_PROPOSAL_NOT_PENDING"
    case syncCursorInvalid = "LIGHTTICK_SYNC_CURSOR_INVALID"
    case syncBatchTooLarge = "LIGHTTICK_SYNC_BATCH_TOO_LARGE"
    case syncOperationRejected = "LIGHTTICK_SYNC_OPERATION_REJECTED"
    case timezoneInvalid = "LIGHTTICK_TIMEZONE_INVALID"
    case rateLimited = "RATE_LIMITED"
    case internalError = "INTERNAL_ERROR"
}

public struct LightTickErrorEnvelope: Codable, Sendable {
    public let code: LightTickErrorCode
    public let message: String
    public let data: LightTickErrorData
    public let requestId: String
}

public enum LightTickRuntimeEnvironment: String, Codable, Sendable {
    case local, dev, online
}

public enum LightTickAccountKind: String, Codable, Sendable {
    case guest, registered
}

public struct LightTickPublicFeatureFlags: Codable, Sendable {
    public let guestSessions: Bool
    public let accountUpgrade: Bool
    public let sync: Bool
    public let notifications: Bool
    public let aiCoach: Bool

    enum CodingKeys: String, CodingKey {
        case sync, notifications
        case guestSessions = "guest_sessions"
        case accountUpgrade = "account_upgrade"
        case aiCoach = "ai_coach"
    }
}

public struct LightTickMinimumClientVersions: Codable, Sendable {
    public let ios: String
    public let android: String
}

public struct LightTickPublicConfigData: Codable, Sendable {
    public let appId: String
    public let enabled: Bool
    public let environment: LightTickRuntimeEnvironment
    public let configurationVersion: String
    public let minimumClientVersions: LightTickMinimumClientVersions
    public let guestSessionTtlSeconds: Int
    public let features: LightTickPublicFeatureFlags
    public let privacyPolicyUrl: URL?
    public let termsOfServiceUrl: URL?
    public let supportUrl: URL?
    public let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case enabled, environment, features
        case appId = "app_id"
        case configurationVersion = "configuration_version"
        case minimumClientVersions = "minimum_client_versions"
        case guestSessionTtlSeconds = "guest_session_ttl_seconds"
        case privacyPolicyUrl = "privacy_policy_url"
        case termsOfServiceUrl = "terms_of_service_url"
        case supportUrl = "support_url"
        case updatedAt = "updated_at"
    }
}

public struct LightTickGuestSessionData: Codable, Sendable {
    public let accountKind: LightTickAccountKind
    public let userId: String
    public let deviceId: String
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let guestExpiresAt: Date
    public let upgradeToken: String

    enum CodingKeys: String, CodingKey {
        case accountKind = "account_kind"
        case userId = "user_id"
        case deviceId = "device_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case guestExpiresAt = "guest_expires_at"
        case upgradeToken = "upgrade_token"
    }
}

public struct LightTickAccountSessionData: Codable, Sendable {
    public let appId: String
    public let accountKind: LightTickAccountKind
    public let userId: String
    public let membershipStatus: String
    public let sessionExpiresAt: Date
    public let guestExpiresAt: Date?
    public let syncCursor: String?

    enum CodingKeys: String, CodingKey {
        case appId = "app_id"
        case accountKind = "account_kind"
        case userId = "user_id"
        case membershipStatus = "membership_status"
        case sessionExpiresAt = "session_expires_at"
        case guestExpiresAt = "guest_expires_at"
        case syncCursor = "sync_cursor"
    }
}

public struct LightTickTransferredResourceCounts: Codable, Sendable, Equatable {
    public let goals: Int
    public let plans: Int
    public let tasks: Int
    public let reviews: Int
    public let proposals: Int
}

public struct LightTickAccountUpgradeData: Codable, Sendable {
    public let accountKind: LightTickAccountKind
    public let userId: String
    public let previousGuestUserId: String
    public let guestSessionRevoked: Bool
    public let idempotencyReplayed: Bool
    public let syncCursor: String?
    public let transferredResourceCounts: LightTickTransferredResourceCounts

    enum CodingKeys: String, CodingKey {
        case accountKind = "account_kind"
        case userId = "user_id"
        case previousGuestUserId = "previous_guest_user_id"
        case guestSessionRevoked = "guest_session_revoked"
        case idempotencyReplayed = "idempotency_replayed"
        case syncCursor = "sync_cursor"
        case transferredResourceCounts = "transferred_resource_counts"
    }
}

public struct LightTickAccountDeletionData: Codable, Sendable {
    public let appId: String
    public let membershipStatus: String
    public let sessionsRevoked: Bool
    public let productDataDeleted: Bool
    public let platformAccountRetained: Bool
    public let otherMembershipsRetained: Bool

    enum CodingKeys: String, CodingKey {
        case appId = "app_id"
        case membershipStatus = "membership_status"
        case sessionsRevoked = "sessions_revoked"
        case productDataDeleted = "product_data_deleted"
        case platformAccountRetained = "platform_account_retained"
        case otherMembershipsRetained = "other_memberships_retained"
    }
}

public struct LightTickErrorData: Codable, Sendable {
    public let retryable: Bool
    public let field: String?
    public let resourceId: String?
    public let currentVersion: Int?
    public let conflictFields: [String]?
    public let resolutionActions: [String]?
    public let retryAfterSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case retryable, field
        case resourceId = "resource_id"
        case currentVersion = "current_version"
        case conflictFields = "conflict_fields"
        case resolutionActions = "resolution_actions"
        case retryAfterSeconds = "retry_after_seconds"
    }
}

public enum LightTickSyncOperationStatus: String, Codable, Sendable {
    case accepted, duplicate, conflict, rejected, retryable
}

public enum LightTickTaskVariant: String, Codable, Sendable {
    case standard, light, minimum
}

public enum LightTickCommitmentMode: String, Codable, Sendable {
    case recovery, light, standard, sprint
}

public struct LightTickTaskVariantDefinition: Codable, Sendable {
    public let title: String
    public let estimatedDurationMinutes: Int
    public let completionCriteria: String

    enum CodingKeys: String, CodingKey {
        case title
        case estimatedDurationMinutes = "estimated_duration_minutes"
        case completionCriteria = "completion_criteria"
    }
}

public struct LightTickStarterTask: Codable, Sendable {
    public let id: String
    public let lineageId: String
    public let title: String
    public let selectedVariant: LightTickTaskVariant
    public let estimatedDurationMinutes: Int
    public let variants: [String: LightTickTaskVariantDefinition]
    public let version: Int

    enum CodingKeys: String, CodingKey {
        case id, title, variants, version
        case lineageId = "lineage_id"
        case selectedVariant = "selected_variant"
        case estimatedDurationMinutes = "estimated_duration_minutes"
    }
}

public struct LightTickStarterCandidate: Codable, Sendable {
    public let candidateId: String
    public let title: String
    public let assumption: String
    public let variants: [String: LightTickTaskVariantDefinition]

    enum CodingKeys: String, CodingKey {
        case title, assumption, variants
        case candidateId = "candidate_id"
    }
}

public struct LightTickStarterData: Codable, Sendable {
    public let source: String
    public let wish: String
    public let assumption: String
    public let recommended: LightTickStarterTask
    public let alternatives: [LightTickStarterCandidate]
}

public struct LightTickSyncOperationResult: Codable, Sendable {
    public let operationId: String
    public let status: LightTickSyncOperationStatus
    public let entityType: String?
    public let entityId: String?
    public let version: Int?
    public let conflictFields: [String]?
    public let resolutionActions: [String]?
    public let errorCode: LightTickErrorCode?

    enum CodingKeys: String, CodingKey {
        case status, version
        case operationId = "operation_id"
        case entityType = "entity_type"
        case entityId = "entity_id"
        case conflictFields = "conflict_fields"
        case resolutionActions = "resolution_actions"
        case errorCode = "error_code"
    }
}

public struct LightTickSyncPushData: Codable, Sendable {
    public let results: [LightTickSyncOperationResult]
    public let serverTime: Date

    enum CodingKeys: String, CodingKey {
        case results
        case serverTime = "server_time"
    }
}

public enum LightTickContractDecoder {
    public static func makeJSONDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
