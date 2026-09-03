// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LightTickContracts",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "LightTickContracts", targets: ["LightTickContracts"]),
    ],
    targets: [
        .target(name: "LightTickContracts"),
        .testTarget(name: "LightTickContractsTests", dependencies: ["LightTickContracts"]),
    ]
)
