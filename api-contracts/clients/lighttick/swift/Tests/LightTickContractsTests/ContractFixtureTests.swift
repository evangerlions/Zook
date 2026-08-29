import Foundation
import XCTest
@testable import LightTickContracts

final class ContractFixtureTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let packageRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let fixtureURL = packageRoot
            .appendingPathComponent("../../../fixtures/lighttick")
            .appendingPathComponent(name)
            .standardizedFileURL
        return try Data(contentsOf: fixtureURL)
    }

    func testSuccessFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickEnvelope<LightTickSyncPushData>.self,
            from: fixture("sync-push-success.json")
        )
        XCTAssertEqual(envelope.code, "OK")
        XCTAssertEqual(envelope.requestId, "req_lighttick_fixture_success")
        XCTAssertEqual(envelope.data.results.map(\.status), [.accepted, .duplicate, .conflict, .rejected, .retryable])
        XCTAssertEqual(envelope.data.results.first?.version, 4)
    }

    func testErrorFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickErrorEnvelope.self,
            from: fixture("version-conflict-error.json")
        )
        XCTAssertEqual(envelope.code, .versionConflict)
        XCTAssertFalse(envelope.data.retryable)
        XCTAssertEqual(envelope.data.currentVersion, 4)
        XCTAssertEqual(envelope.data.resolutionActions, ["accept_server", "create_follow_up"])
    }

    func testProgressiveStarterFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickEnvelope<LightTickStarterData>.self,
            from: fixture("progressive-starter-success.json")
        )
        XCTAssertEqual(envelope.data.recommended.selectedVariant, .standard)
        XCTAssertEqual(Set(envelope.data.recommended.variants.keys), Set(["standard", "light", "minimum"]))
        XCTAssertEqual(envelope.data.alternatives.count, 2)
    }

    func testGuestSessionSuccessFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickEnvelope<LightTickGuestSessionData>.self,
            from: fixture("guest-session-success.json")
        )
        XCTAssertEqual(envelope.data.accountKind, .guest)
        XCTAssertEqual(envelope.data.deviceId, "device_01K4IOS0001")
        XCTAssertEqual(envelope.data.expiresIn, 3_600)
    }

    func testAccountFailureFixturesDecode() throws {
        let decoder = LightTickContractDecoder.makeJSONDecoder()
        let validation = try decoder.decode(
            LightTickErrorEnvelope.self,
            from: fixture("account-validation-error.json")
        )
        XCTAssertEqual(validation.code, .invalidField)
        XCTAssertEqual(validation.data.field, "device_id")

        let retry = try decoder.decode(
            LightTickErrorEnvelope.self,
            from: fixture("account-retry-error.json")
        )
        XCTAssertEqual(retry.code, .rateLimited)
        XCTAssertTrue(retry.data.retryable)
        XCTAssertEqual(retry.data.retryAfterSeconds, 30)

        let revoked = try decoder.decode(
            LightTickErrorEnvelope.self,
            from: fixture("session-revoked-error.json")
        )
        XCTAssertEqual(revoked.code, .sessionRevoked)
        XCTAssertEqual(revoked.data.resolutionActions, ["clear_local_session", "create_guest_or_sign_in"])
    }

    func testLostUpgradeResponseReplayFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickEnvelope<LightTickAccountUpgradeData>.self,
            from: fixture("account-upgrade-lost-response-replay.json")
        )
        XCTAssertEqual(envelope.data.accountKind, .registered)
        XCTAssertTrue(envelope.data.guestSessionRevoked)
        XCTAssertTrue(envelope.data.idempotencyReplayed)
        XCTAssertEqual(envelope.data.transferredResourceCounts.tasks, 4)
    }

    func testDeletionIsolationFixtureDecodes() throws {
        let envelope = try LightTickContractDecoder.makeJSONDecoder().decode(
            LightTickEnvelope<LightTickAccountDeletionData>.self,
            from: fixture("account-deletion-isolation-success.json")
        )
        XCTAssertTrue(envelope.data.productDataDeleted)
        XCTAssertTrue(envelope.data.platformAccountRetained)
        XCTAssertTrue(envelope.data.otherMembershipsRetained)
    }
}
