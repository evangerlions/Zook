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
}
