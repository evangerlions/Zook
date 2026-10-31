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
    case guestCredentialInvalid = "LIGHTTICK_GUEST_CREDENTIAL_INVALID"
    case guestExpired = "LIGHTTICK_GUEST_EXPIRED"
    case guestRevoked = "LIGHTTICK_GUEST_REVOKED"
    case guestUpgradeConflict = "LIGHTTICK_GUEST_UPGRADE_CONFLICT"
    case accountAlreadyUpgraded = "LIGHTTICK_ACCOUNT_ALREADY_UPGRADED"
    case accountDeletionReauthenticationRequired = "LIGHTTICK_ACCOUNT_DELETION_REAUTH_REQUIRED"
    case reauthenticationRequired = "LIGHTTICK_REAUTH_REQUIRED"
    case appAccessDenied = "LIGHTTICK_APP_ACCESS_DENIED"
    case resourceNotFound = "LIGHTTICK_RESOURCE_NOT_FOUND"
    case invalidStateTransition = "LIGHTTICK_STATE_TRANSITION_INVALID"
    case versionConflict = "LIGHTTICK_VERSION_CONFLICT"
    case idempotencyMismatch = "LIGHTTICK_IDEMPOTENCY_MISMATCH"
    case planningBusy = "LIGHTTICK_PLANNING_BUSY"
    case planningNotReady = "LIGHTTICK_PLANNING_NOT_READY"
    case planningStale = "LIGHTTICK_PLANNING_STALE"
    case planningContextTooLarge = "LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE"
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
    public let privacyPolicyUrl: URL
    public let termsOfServiceUrl: URL
    public let supportUrl: URL
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

public struct LightTickTaskStepData: Codable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let completed: Bool
    public let position: Int
}

public struct LightTickTaskData: Codable, Sendable {
    public let id: String
    public let lineageId: String?
    public let planId: String
    public let title: String
    public let completionCriteria: String?
    public let selectedVariant: LightTickTaskVariant?
    public let variants: [String: LightTickTaskVariantDefinition]?
    public let status: String
    public let scheduledDate: String
    public let estimatedDurationMinutes: Int
    public let actualDurationMinutes: Int?
    public let priority: Int
    public let steps: [LightTickTaskStepData]
    public let note: String?
    public let version: Int

    enum CodingKeys: String, CodingKey {
        case id, title, variants, status, priority, steps, note, version
        case lineageId = "lineage_id"
        case planId = "plan_id"
        case completionCriteria = "completion_criteria"
        case selectedVariant = "selected_variant"
        case scheduledDate = "scheduled_date"
        case estimatedDurationMinutes = "estimated_duration_minutes"
        case actualDurationMinutes = "actual_duration_minutes"
    }
}

public struct LightTickTodayData: Codable, Sendable {
    public let businessDate: String
    public let timezone: String
    public let primaryTask: LightTickTaskData?
    public let tasks: [LightTickTaskData]
    public let completedTasks: [LightTickTaskData]
    public let remainingEstimatedMinutes: Int
    public let planBAvailable: Bool
    public let snapshotVersion: Int

    enum CodingKeys: String, CodingKey {
        case timezone, tasks
        case businessDate = "business_date"
        case primaryTask = "primary_task"
        case completedTasks = "completed_tasks"
        case remainingEstimatedMinutes = "remaining_estimated_minutes"
        case planBAvailable = "plan_b_available"
        case snapshotVersion = "snapshot_version"
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


/// GET /api/v1/lighttick/onboarding/commitment (account-scoped, read-only).
public struct LightTickCommitmentState: Codable, Equatable, Sendable {
    public let commitmentMode: String?
    public let validActionCount: Int
    public let requiredActionCount: Int
    public let eligible: Bool
    enum CodingKeys: String, CodingKey {
        case commitmentMode = "commitment_mode", validActionCount = "valid_action_count"
        case requiredActionCount = "required_action_count", eligible
    }
}

// BEGIN GENERATED PLANNING SESSION

public enum PlanningScalar: Codable, Equatable, Sendable {
    case text(String), minutes(Int)
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let n = try? c.decode(Int.self) { self = .minutes(n) } else { self = .text(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .text(let s): try c.encode(s); case .minutes(let n): try c.encode(n) }
    }
    public var display: String { switch self { case .text(let s): s; case .minutes(let n): String(n) } }
}
public struct PlanningValue: Codable, Equatable, Sendable {
    public let value: PlanningScalar
    public let source: String
    public let source_message_id: String?
}
public struct PlanningSession: Codable, Equatable, Sendable {

    public let id: String
    public let goal_id: String
    public let thread_id: String
    public let status: String
    public let version: Int
    public let context_revision: Int
    public let context: [String: PlanningValue]
    public let questions: [String]
    public let clarification_rounds: Int
    public let active_run_id: String?
    public let draft_plan_id: String?
    public let draft_revision: Int?
    public let draft_expires_at: String?
    public let last_error: String?
    public let can_generate: Bool
    public let created_at: String
    public let updated_at: String
}
// END GENERATED PLANNING SESSION

// Shared action workspace. Generated by build_scripts/generate_action_clients.py.
public struct LightTickManualAction: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var scheduled_for: String?
    public var estimated_minutes: Int?
    public var completion_criteria: String
    public var guidance: String
}
public struct LightTickManualDraft: Codable, Equatable, Sendable {
    public var goal_id: String?
    public var title: String
    public var completion_criteria: String
    public var period_start: String
    public var period_end: String
    public var tasks: [LightTickManualAction]
}
public struct LightTickManualTask: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var goal_id: String
    public var plan_id: String
    public var title: String
    public var status: String
    public var scheduled_date: String?
    public var estimated_duration_minutes: Int?
    public var completion_criteria: String
    public var notes: String
    public var completed_at: String?
    public var version: Int
}
public struct LightTickManualPlan: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var goal_id: String
    public var goal_version: Int
    public var version: Int
    public var status: String
    public var draft: LightTickManualDraft
    public var preserved_tasks: [LightTickManualTask]
    public var tasks: [LightTickManualTask]
}
public struct LightTickLocalGoal: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var criteria: String
    public var status: String
    public var archived: Bool
}
public struct LightTickLocalAction: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var goal_id: String
    public var title: String
    public var date: String?
    public var estimated_minutes: Int?
    public var criteria: String
    public var details: String
    public var completed_at: String?
    public var archived: Bool
    public var source_reflection_id: String?
}
public struct LightTickLocalReflection: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var goal_id: String
    public var action_id: String?
    public var result: String
    public var obstacles: String
    public var next_step: String
    public var created_at: String
}
public struct LightTickLocalEvent: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var entity_id: String
    public var kind: String
    public var value: String
    public var created_at: String
}
public struct LightTickLocalAdoption: Codable, Equatable, Sendable {
    public var workspace_id: String
    public var source_secret: String
    public var goals: [LightTickLocalGoal]
    public var actions: [LightTickLocalAction]
    public var reflections: [LightTickLocalReflection]
    public var events: [LightTickLocalEvent]
}
public struct LightTickLocalMapping: Codable, Equatable, Sendable {
    public var kind: String
    public var local_id: String
    public var cloud_id: String
}
public struct LightTickLocalReceipt: Codable, Equatable, Sendable {
    public var receipt_id: String
    public var owner_id: String
    public var mappings: [LightTickLocalMapping]
    public var adopted_at: String
}
public struct LightTickActionTarget: Codable, Equatable, Sendable {
    public var kind: String
    public var course: String?
    public var plan_id: String?
    public var lesson_no: Int?
}
public struct LightTickActionProgress: Codable, Equatable, Sendable {
    public var minutes: Int
    public var completed: Int
    public var minimum: Int
    public var interrupted: Int
    public var partial: Int
}
public struct LightTickActionCapabilities: Codable, Equatable, Sendable {
    public var nullable_schedule: Bool
    public var completion_modes: [String]
    public var content_receipts: [String]
    public var actual_fact_dates: Bool
    public var connection_write_enabled: Bool
    public var source_delivery_enabled: Bool
    public var v2_import_enabled: Bool
    public var practice_follow_up: Bool?
    public var learning_practice: Bool?
}
public struct LightTickPracticeSource: Codable, Equatable, Sendable, Identifiable {
    public var kind: String
    public var id: String
    public var version: String
    public var binding_id: String?
}
public struct LightTickPracticeOrigin: Codable, Equatable, Sendable {
    public var plan_id: String
    public var feedback_id: String
}
public struct LightTickPracticeFeedback: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var created_at: String
    public var outcome: String
    public var result: String
    public var evidence: String
    public var next_step: String
}
public struct LightTickActionPlan: Codable, Equatable, Sendable, Identifiable {
    public var title: String
    public var period: String
    public var horizon: String
    public var start_date: String?
    public var end_date: String?
    public var timezone: String
    public var parent_id: String?
    public var target_minutes: Int?
    public var minimum_minutes: Int?
    public var target_count: Int
    public var at: String?
    public var reminder: Bool
    public var reason: String
    public var if_then: String
    public var target: LightTickActionTarget?
    public var completion_mode: String
    public var estimated_minutes: Int?
    public var id: String
    public var revision: Int
    public var status: String
    public var created_at: String
    public var updated_at: String
    public var reminder_at: String?
    public var progress: LightTickActionProgress?
    public var blocked: Bool?
    public var schema_version: Int
    public var completed_at: String?
    public var completion_record_id: String?
    public var practice_origin: LightTickPracticeOrigin?
    public var practice_source: LightTickPracticeSource?
    public var practice_feedback: [LightTickPracticeFeedback]?
}
public struct LightTickActionExecution: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var plan_id: String
    public var title: String
    public var started_at: String
    public var ended_at: String?
    public var variant: String
    public var planned_minutes: Int?
    public var actual_minutes: Int
    public var outcome: String
    public var note: String
    public var business_date: String
    public var timezone: String
    public var target: LightTickActionTarget?
    public var schema_version: Int
    public var record_kind: String
    public var completion_mode: String
    public var completion_effect: String
    public var planned_date: String?
    public var date_basis: String
    public var reverses_record_id: String?
    public var source_event_id: String?
    public var recorded_at: String?
}
public struct LightTickActionWorkspace: Codable, Equatable, Sendable {
    public var plans: [LightTickActionPlan]
    public var execution: LightTickActionExecution?
    public var server_time: String
    public var workspace_version: Int
    public var reminder_delivery: String
    public var action_schema_version: Int
    public var capabilities: LightTickActionCapabilities
}
public struct LightTickLearningStageProgress: Codable, Equatable, Sendable {
    public var number: Int
    public var title: String
    public var total_lessons: Int
    public var published_lessons: Int
    public var completed_lessons: Int
    public var percent: Int
}
public struct LightTickLearningPlanProgress: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var version: Int
    public var status: String
    public var total_lessons: Int
    public var published_lessons: Int
    public var completed_lessons: Int
    public var percent: Int
    public var stages: [LightTickLearningStageProgress]
}
public struct LightTickLearningProgress: Codable, Equatable, Sendable {
    public var source_revision: Int
    public var observed_at: String
    public var received_at: String
    public var web_url: String
    public var plans: [LightTickLearningPlanProgress]
}
public struct LightTickLearningProgressData: Codable, Equatable, Sendable {
    public var progress: LightTickLearningProgress?
}
public struct LightTickLearningLessonSummary: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var collection_id: String
    public var collection_title: String
    public var number: Int
    public var title: String
    public var content_version: String
    public var learning_state: String
    public var source_url: String
}
public struct LightTickLearningLesson: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var collection_id: String
    public var collection_title: String
    public var number: Int
    public var title: String
    public var content_version: String
    public var learning_state: String
    public var source_url: String
    public var content: String
    public var references: String
}
public struct LightTickLearningLibraryData: Codable, Equatable, Sendable {
    public var consent_enabled: Bool
    public var binding_id: String?
    public var observed_at: String?
    public var lessons: [LightTickLearningLessonSummary]
}
public struct LightTickLearningLessonData: Codable, Equatable, Sendable {
    public var lesson: LightTickLearningLesson
    public var binding_id: String
    public var observed_at: String
}
public struct LightTickLearningAnswer: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var prompt: String
    public var answer: String
}
public struct LightTickLearningPrivateState: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var content_version: String
    public var draft_version: String
    public var revision: Int
    public var notes: String
    public var answers: [LightTickLearningAnswer]
    public var completed: Bool
    public var completed_at: String?
    public var position: Int
    public var updated_at: String
    public var questions: [LightTickLearningAnswer]
}
public struct LightTickLearningPrivateOperation: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var status: String
    public var error: String
}
public struct LightTickLearningPrivateData: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var state: LightTickLearningPrivateState?
    public var operations: [LightTickLearningPrivateOperation]
}
public struct LightTickLearningPrivateCommand: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var content_version: String
    public var revision: Int
    public var action: String
    public var notes: String
    public var answers: [LightTickLearningAnswer]
    public var position: Int
}

// Independent personal records. Date strings represent business dates, not instants.
public struct LightTickRecordSource: Codable, Equatable, Sendable {
    public var instance: String; public var id: String; public var imported_at: String; public var missing_versions: [Int]
}
public struct LightTickRecord: Codable, Sendable, Identifiable, Equatable {
    public var source: LightTickRecordSource? = nil
    public var id: String
    public var raw_text: String
    public var record_date: String
    public var prompt_kind: String
    public var guided_answers: [String: String]
    public var tags: [String]
    public var adopted_summary: String?
    public var summary_basis_version: Int?
    public var archived_at: String?
    public var version: Int
    public var created_at: String
    public var updated_at: String
}
public struct LightTickRecordPage: Codable, Sendable {
    public let items: [LightTickRecord]
    public let has_more: Bool
    public let next_cursor: String?
}
public struct LightTickRecordVersions: Codable, Sendable {
    public let items: [LightTickRecord]
}
