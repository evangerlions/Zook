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
}
