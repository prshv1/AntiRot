// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Antirot",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "Antirot", targets: ["Antirot"]),
        .executable(name: "AntirotNativeHost", targets: ["AntirotNativeHost"])
    ],
    targets: [
        .executableTarget(name: "Antirot"),
        .executableTarget(name: "AntirotNativeHost")
    ]
)
