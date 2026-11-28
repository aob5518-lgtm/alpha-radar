// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "AlphaRadarMac",
  platforms: [.macOS(.v15)],
  products: [.executable(name: "AlphaRadarMac", targets: ["AlphaRadarMac"])],
  targets: [
    .target(name: "ExecutorCore"),
    .executableTarget(name: "AlphaRadarMac", dependencies: ["ExecutorCore"]),
    .executableTarget(
      name: "ExecutorCoreChecks", dependencies: ["ExecutorCore"], path: "Tests/ExecutorCoreTests"),
    .executableTarget(name: "MirroringProbe", dependencies: ["ExecutorCore"]),
  ]
)
