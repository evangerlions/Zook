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
    case appScopeForbidden = "APP_SCOPE_FORBIDDEN"
    case inactiveMember = "APP_MEMBER_INACTIVE"
    case appDisabled = "LIGHTTICK_APP_DISABLED"
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
