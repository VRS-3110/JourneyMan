// swift-tools-version: 6.0
import PackageDescription

// The JourneyMan Mac app: a native window around the same web app (index.html, css/, js/ at the
// repo root), with native access to ~/Documents/JourneyMan and the Mac's calendars.
// Built with the Command Line Tools alone; Scripts/build-app.sh wraps it into JourneyMan.app.
// Swift 5 language mode, as in Atlas.
let package = Package(
    name: "JourneyMan",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "JourneyMan", swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
