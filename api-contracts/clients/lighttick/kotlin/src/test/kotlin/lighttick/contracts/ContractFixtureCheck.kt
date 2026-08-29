package lighttick.contracts

import java.io.File

private fun String.requireContains(value: String) {
    check(contains(value)) { "fixture is missing expected contract value: $value" }
}

fun main(args: Array<String>) {
    val fixtureRoot = File(args.single())
    val success = fixtureRoot.resolve("sync-push-success.json").readText()
    success.requireContains("\"code\": \"OK\"")
    success.requireContains("\"status\": \"accepted\"")
    success.requireContains("\"status\": \"duplicate\"")
    success.requireContains("\"status\": \"conflict\"")
    success.requireContains("\"status\": \"rejected\"")
    success.requireContains("\"status\": \"retryable\"")
    success.requireContains("\"server_time\": \"2026-08-19T10:30:00Z\"")

    val result = LightTickSyncOperationResult(
        operationId = "op_01JZLIGHTTICK001",
        status = LightTickSyncOperationStatus.accepted,
        entityType = "task",
        entityId = "task_01JZLIGHTTICK01",
        version = 4,
    )
    check(result.status == LightTickSyncOperationStatus.accepted)

    val error = fixtureRoot.resolve("version-conflict-error.json").readText()
    error.requireContains("\"code\": \"LIGHTTICK_VERSION_CONFLICT\"")
    error.requireContains("\"retryable\": false")
    error.requireContains("\"current_version\": 4")
    check(LightTickErrorCode.valueOf("LIGHTTICK_VERSION_CONFLICT") == LightTickErrorCode.LIGHTTICK_VERSION_CONFLICT)

    val starter = fixtureRoot.resolve("progressive-starter-success.json").readText()
    starter.requireContains("\"source\": \"deterministic_template\"")
    starter.requireContains("\"selected_variant\": \"standard\"")
    starter.requireContains("\"candidate_id\": \"candidate_3\"")
    check(LightTickTaskVariant.valueOf("minimum") == LightTickTaskVariant.minimum)

    val guest = fixtureRoot.resolve("guest-session-success.json").readText()
    guest.requireContains("\"account_kind\": \"guest\"")
    guest.requireContains("\"upgrade_token\": \"fixture-device-bound-upgrade-token-0001\"")
    check(LightTickAccountKind.valueOf("guest") == LightTickAccountKind.guest)

    val validation = fixtureRoot.resolve("account-validation-error.json").readText()
    validation.requireContains("\"code\": \"REQ_FIELD_INVALID\"")
    validation.requireContains("\"field\": \"device_id\"")

    val retry = fixtureRoot.resolve("account-retry-error.json").readText()
    retry.requireContains("\"retryable\": true")
    retry.requireContains("\"retry_after_seconds\": 30")

    val revoked = fixtureRoot.resolve("session-revoked-error.json").readText()
    revoked.requireContains("\"code\": \"AUTH_SESSION_REVOKED\"")
    check(LightTickErrorCode.valueOf("AUTH_SESSION_REVOKED") == LightTickErrorCode.AUTH_SESSION_REVOKED)

    val replay = fixtureRoot.resolve("account-upgrade-lost-response-replay.json").readText()
    replay.requireContains("\"idempotency_replayed\": true")
    replay.requireContains("\"tasks\": 4")
    val upgrade = LightTickAccountUpgradeData(
        accountKind = LightTickAccountKind.registered,
        userId = "user_01K4REGISTERED",
        previousGuestUserId = "guest_01K4LIGHTTICK",
        guestSessionRevoked = true,
        idempotencyReplayed = true,
        transferredResourceCounts = LightTickTransferredResourceCounts(1, 1, 4, 0, 0),
    )
    check(upgrade.transferredResourceCounts.tasks == 4)

    val deletion = fixtureRoot.resolve("account-deletion-isolation-success.json").readText()
    deletion.requireContains("\"product_data_deleted\": true")
    deletion.requireContains("\"platform_account_retained\": true")
    deletion.requireContains("\"other_memberships_retained\": true")
}
