import AppKit
import Foundation
import SwiftUI

private let antiRotExtensionID = "emlpideklhedelfijihmafgnekgloddk"
private let chromeWebStoreUpdateURL = "https://clients2.google.com/service/update2/crx"
private let antiRotPolicyValue = "\(antiRotExtensionID);\(chromeWebStoreUpdateURL)"
private let nativeHostName = "in.antirot.nativehost"

@main
struct AntirotApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(width: 620)
        }
        .windowResizability(.contentSize)
    }
}

struct ContentView: View {
    @State private var selectedTargetIDs = Set(BrowserPolicyTarget.defaultTargets.map(\.id))
    @State private var discoveredTargets: [BrowserPolicyTarget] = []
    @State private var installedPolicyDomains: Set<String> = []
    @State private var savedState = AppState.empty
    @State private var statusText = "Ready."
    @State private var isWorking = false

    private var availableTargets: [BrowserPolicyTarget] {
        uniqueTargets(BrowserPolicyTarget.all + discoveredTargets)
    }

    private var otherTargets: [BrowserPolicyTarget] {
        let knownDomains = Set(BrowserPolicyTarget.all.map(\.policyDomain))
        return discoveredTargets.filter { !knownDomains.contains($0.policyDomain) }
    }

    private var selectedTargets: [BrowserPolicyTarget] {
        availableTargets.filter { selectedTargetIDs.contains($0.id) }
    }

    private var allTargetsBinding: Binding<Bool> {
        Binding(
            get: {
                Set(availableTargets.map(\.id)).isSubset(of: selectedTargetIDs)
            },
            set: { isSelected in
                let allIDs = availableTargets.map(\.id)
                if isSelected {
                    selectedTargetIDs.formUnion(allIDs)
                } else {
                    selectedTargetIDs.subtract(allIDs)
                }
                saveSelectedBrowserChoices()
            }
        )
    }

    private var policyStatusText: String {
        if installedPolicyDomains.isEmpty {
            return "Protection is not installed."
        }

        let knownNames = availableTargets
            .filter { installedPolicyDomains.contains($0.policyDomain) }
            .map(\.displayName)
        let knownDomains = Set(availableTargets.map(\.policyDomain))
        let otherNames = installedPolicyDomains
            .subtracting(knownDomains)
            .sorted()

        let names = (knownNames + otherNames).joined(separator: ", ")

        return "Protection installed for \(names)."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("System lockdown")
                    .font(.headline)
                Text("When lockdown is on, Antirot can ask selected browsers to keep the extension installed and block changes from the extensions page.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Browsers")
                    .font(.headline)

                Toggle(isOn: allTargetsBinding) {
                    Text("All")
                        .fontWeight(.semibold)
                }
                .disabled(isWorking)

                ForEach(BrowserPolicyTarget.all) { target in
                    browserToggle(for: target)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Other Detected Browsers")
                        .font(.subheadline)
                        .fontWeight(.semibold)

                    if otherTargets.isEmpty {
                        Text("No extra browser apps found. Web apps like Spotify and Todoist are ignored here.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("These are apps that look like real Chromium browsers. Choose only the ones you want Antirot to protect.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        ForEach(otherTargets) { target in
                            browserToggle(for: target)
                        }
                    }
                }
                .padding(.top, 4)
            }

            HStack(spacing: 12) {
                Button("Apply Protection") {
                    startProtection()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isWorking || selectedTargets.isEmpty)

                Button("Remove Protection") {
                    removeProtection()
                }
                .disabled(isWorking || installedPolicyDomains.isEmpty)

                Button("Refresh") {
                    refreshStatus()
                }
                .disabled(isWorking)
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Label(policyStatusText, systemImage: installedPolicyDomains.isEmpty ? "lock.open" : "lock.shield")
                Text(statusText)
                    .foregroundStyle(.secondary)
            }
            .font(.callout)
        }
        .padding(24)
        .onAppear {
            refreshStatus()
            installBrowserLink()
        }
    }

    private func browserToggle(for target: BrowserPolicyTarget) -> some View {
        Toggle(isOn: Binding(
            get: { selectedTargetIDs.contains(target.id) },
            set: { isSelected in
                if isSelected {
                    selectedTargetIDs.insert(target.id)
                } else {
                    selectedTargetIDs.remove(target.id)
                }
                saveSelectedBrowserChoices()
            }
        )) {
            HStack {
                Text(target.displayName)
                if target.isDetected {
                    Text("detected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if !target.isInstalled {
                    Text("not found")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .disabled(isWorking)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(nsImage: appIconImage)
                .resizable()
                .frame(width: 46, height: 46)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text("Antirot")
                    .font(.largeTitle.bold())
                Text("Small local app for extension lockdown. No background persistence yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func startProtection() {
        let targets = selectedTargets
        guard !targets.isEmpty else {
            statusText = "Pick at least one browser."
            return
        }

        isWorking = true
        statusText = "Waiting for macOS admin approval..."

        Task {
            do {
                try await Task.detached {
                    try PolicyManager.applyProtection(to: targets)
                }.value

                let state = AppState(
                    policyDomains: targets.map(\.policyDomain)
                )
                try StateStore.save(state)

                await MainActor.run {
                    savedState = state
                    refreshStatus()
                    statusText = "Protection is on. The extension can also do this automatically during lockdown."
                    isWorking = false
                }
            } catch {
                await MainActor.run {
                    statusText = "Could not start protection: \(error.localizedDescription)"
                    isWorking = false
                }
            }
        }
    }

    private func removeProtection() {
        let domains = installedPolicyDomains
        let targets = domains.map { domain in
            BrowserPolicyTarget.knownTarget(forPolicyDomain: domain, discoveredTargets: discoveredTargets)
                ?? BrowserPolicyTarget(
                    id: "installed-\(domain)",
                    displayName: domain,
                    policyDomain: domain,
                    appPaths: [],
                    isDetected: true
                )
        }

        isWorking = true
        statusText = "Waiting for macOS admin approval..."

        Task {
            do {
                try await Task.detached {
                    try PolicyManager.removeProtection(from: targets)
                }.value

                await MainActor.run {
                    refreshStatus()
                    statusText = "Protection was removed. Restart the browser if the extensions page still looks managed."
                    isWorking = false
                }
            } catch {
                await MainActor.run {
                    statusText = "Could not remove protection: \(error.localizedDescription)"
                    isWorking = false
                }
            }
        }
    }

    private func refreshStatus() {
        let detected = BrowserDiscovery.findInstalledChromiumBrowsers(
            excluding: Set(BrowserPolicyTarget.all.map(\.policyDomain))
        )
        discoveredTargets = detected

        if let state = try? StateStore.load() {
            savedState = state
            selectedTargetIDs = Set(
                availableTargets
                    .filter { state.policyDomains.contains($0.policyDomain) }
                    .map(\.id)
            )
        } else {
            saveSelectedBrowserChoices()
        }

        let domains = availableTargets.map(\.policyDomain) + savedState.policyDomains

        installedPolicyDomains = PolicyManager.installedPolicyDomains(policyDomains: domains)
    }

    private func installBrowserLink() {
        do {
            let installedCount = try NativeMessagingInstaller.install()
            statusText = "Ready. Browser link installed for \(installedCount) browser profiles."
        } catch {
            statusText = "Ready, but the browser link could not be installed: \(error.localizedDescription)"
        }
    }

    private func saveSelectedBrowserChoices() {
        let policyDomains = selectedTargets.map(\.policyDomain)
        let state = AppState(policyDomains: policyDomains)
        try? StateStore.save(state)
        savedState = state
    }

    private var appIconImage: NSImage {
        if let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let image = NSImage(contentsOf: iconURL) {
            return image
        }
        return NSApp.applicationIconImage
    }

    private func uniqueTargets(_ targets: [BrowserPolicyTarget]) -> [BrowserPolicyTarget] {
        var seen = Set<String>()
        return targets.filter { target in
            if seen.contains(target.policyDomain) {
                return false
            }
            seen.insert(target.policyDomain)
            return true
        }
    }
}

struct BrowserPolicyTarget: Identifiable, Hashable {
    let id: String
    let displayName: String
    let policyDomain: String
    let appPaths: [String]
    let isDetected: Bool

    init(
        id: String,
        displayName: String,
        policyDomain: String,
        appPaths: [String],
        isDetected: Bool = false
    ) {
        self.id = id
        self.displayName = displayName
        self.policyDomain = policyDomain
        self.appPaths = appPaths
        self.isDetected = isDetected
    }

    var isInstalled: Bool {
        appPaths.contains { FileManager.default.fileExists(atPath: $0) }
    }

    static let all: [BrowserPolicyTarget] = [
        BrowserPolicyTarget(
            id: "chrome",
            displayName: "Google Chrome",
            policyDomain: "com.google.Chrome",
            appPaths: ["/Applications/Google Chrome.app"]
        ),
        BrowserPolicyTarget(
            id: "brave",
            displayName: "Brave",
            policyDomain: "com.brave.Browser",
            appPaths: ["/Applications/Brave Browser.app"]
        ),
        BrowserPolicyTarget(
            id: "helium",
            displayName: "Helium",
            policyDomain: "net.imput.helium",
            appPaths: ["/Applications/Helium.app"]
        ),
        BrowserPolicyTarget(
            id: "arc",
            displayName: "Arc",
            policyDomain: "company.thebrowser.Browser",
            appPaths: ["/Applications/Arc.app"]
        ),
        BrowserPolicyTarget(
            id: "vivaldi",
            displayName: "Vivaldi",
            policyDomain: "com.vivaldi.Vivaldi",
            appPaths: ["/Applications/Vivaldi.app"]
        ),
        BrowserPolicyTarget(
            id: "opera",
            displayName: "Opera",
            policyDomain: "com.operasoftware.Opera",
            appPaths: ["/Applications/Opera.app"]
        ),
        BrowserPolicyTarget(
            id: "opera-gx",
            displayName: "Opera GX",
            policyDomain: "com.operasoftware.OperaGX",
            appPaths: ["/Applications/Opera GX.app"]
        ),
        BrowserPolicyTarget(
            id: "edge",
            displayName: "Microsoft Edge",
            policyDomain: "com.microsoft.Edge",
            appPaths: ["/Applications/Microsoft Edge.app"]
        ),
        BrowserPolicyTarget(
            id: "chromium",
            displayName: "Chromium",
            policyDomain: "org.chromium.Chromium",
            appPaths: ["/Applications/Chromium.app"]
        )
    ]

    static var defaultTargets: [BrowserPolicyTarget] {
        let installed = all.filter(\.isInstalled)
        return installed.isEmpty ? [all[0]] : installed
    }

    static func knownTarget(
        forPolicyDomain policyDomain: String,
        discoveredTargets: [BrowserPolicyTarget] = []
    ) -> BrowserPolicyTarget? {
        (all + discoveredTargets).first { $0.policyDomain == policyDomain }
    }

    static func isValidPolicyDomain(_ policyDomain: String) -> Bool {
        let pattern = #"^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$"#
        return policyDomain.range(of: pattern, options: .regularExpression) != nil
            && policyDomain.contains(".")
    }
}

struct AppState: Codable, Equatable {
    let policyDomains: [String]

    static let empty = AppState(policyDomains: [])
}

enum BrowserDiscovery {
    static func findInstalledChromiumBrowsers(excluding knownPolicyDomains: Set<String>) -> [BrowserPolicyTarget] {
        let appURLs = applicationRoots().flatMap { appBundles(in: $0, maxDepth: 2) }

        let targets = appURLs.compactMap { appURL -> BrowserPolicyTarget? in
            guard let target = target(for: appURL),
                  !knownPolicyDomains.contains(target.policyDomain) else {
                return nil
            }
            return target
        }

        var seen = Set<String>()
        return targets
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
            .filter { target in
                if seen.contains(target.policyDomain) {
                    return false
                }
                seen.insert(target.policyDomain)
                return true
            }
    }

    private static func applicationRoots() -> [URL] {
        var roots = [URL(fileURLWithPath: "/Applications", isDirectory: true)]
        if let homeApplications = FileManager.default.urls(for: .applicationDirectory, in: .userDomainMask).first {
            roots.append(homeApplications)
        }
        return roots
    }

    private static func appBundles(in directory: URL, maxDepth: Int) -> [URL] {
        guard maxDepth >= 0,
              let contents = try? FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
              ) else {
            return []
        }

        var apps: [URL] = []
        for url in contents {
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                continue
            }

            if url.pathExtension == "app" {
                apps.append(url)
                continue
            }

            apps.append(contentsOf: appBundles(in: url, maxDepth: maxDepth - 1))
        }
        return apps
    }

    private static func target(for appURL: URL) -> BrowserPolicyTarget? {
        let infoURL = appURL.appendingPathComponent("Contents/Info.plist")
        guard let info = NSDictionary(contentsOf: infoURL) as? [String: Any],
              let bundleID = info["CFBundleIdentifier"] as? String,
              BrowserPolicyTarget.isValidPolicyDomain(bundleID) else {
            return nil
        }

        let displayName =
            (info["CFBundleDisplayName"] as? String)
            ?? (info["CFBundleName"] as? String)
            ?? appURL.deletingPathExtension().lastPathComponent

        guard looksLikeChromiumBrowser(appURL: appURL, info: info, displayName: displayName) else {
            return nil
        }

        return BrowserPolicyTarget(
            id: "detected-\(bundleID)",
            displayName: displayName,
            policyDomain: bundleID,
            appPaths: [appURL.path],
            isDetected: true
        )
    }

    private static func looksLikeChromiumBrowser(
        appURL: URL,
        info: [String: Any],
        displayName: String
    ) -> Bool {
        let hasPolicyManifest = hasChromiumPolicyManifest(appURL: appURL)
        let handlesChromeExtensions = declaresChromiumDocumentType(info: info)
        let hasBrowserEngine = hasChromiumFrameworkResources(appURL: appURL)
        let nameLooksLikeBrowser = browserishName(displayName)

        return hasPolicyManifest
            || handlesChromeExtensions
            || (hasBrowserEngine && nameLooksLikeBrowser)
    }

    private static func hasChromiumPolicyManifest(appURL: URL) -> Bool {
        let resourcesURL = appURL.appendingPathComponent("Contents/Resources", isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: resourcesURL,
            includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        var inspectedFiles = 0
        for case let fileURL as URL in enumerator {
            guard inspectedFiles < 80 else { break }
            let filename = fileURL.lastPathComponent.lowercased()
            guard filename.contains("manifest") else { continue }
            inspectedFiles += 1

            guard let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  (values.fileSize ?? 0) < 2_000_000,
                  let data = try? Data(contentsOf: fileURL),
                  let contents = String(data: data, encoding: .utf8) else {
                continue
            }

            if contents.contains("ExtensionInstallForcelist") {
                return true
            }
        }

        return false
    }

    private static func hasChromiumFrameworkResources(appURL: URL) -> Bool {
        let frameworksURL = appURL.appendingPathComponent("Contents/Frameworks", isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: frameworksURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        var foundChromePak = false
        var foundResourcesPak = false

        for case let fileURL as URL in enumerator {
            switch fileURL.lastPathComponent {
            case "chrome_100_percent.pak", "chrome_200_percent.pak":
                foundChromePak = true
            case "resources.pak":
                foundResourcesPak = true
            default:
                break
            }

            if foundChromePak && foundResourcesPak {
                return true
            }
        }

        return false
    }

    private static func declaresChromiumDocumentType(info: [String: Any]) -> Bool {
        guard let documentTypes = info["CFBundleDocumentTypes"] as? [[String: Any]] else {
            return false
        }

        return documentTypes.contains { type in
            let values = type.values.map { "\($0)" }.joined(separator: " ").lowercased()
            return values.contains("chromium extension") || values.contains("chrome extension")
        }
    }

    private static func browserishName(_ displayName: String) -> Bool {
        let name = displayName.lowercased()
        return [
            "browser",
            "chrome",
            "chromium",
            "brave",
            "edge",
            "arc",
            "vivaldi",
            "opera",
            "helium",
            "thorium",
            "ungoogled"
        ].contains { name.contains($0) }
    }
}

enum NativeMessagingInstaller {
    private static let manifestFileName = "\(nativeHostName).json"

    static func install() throws -> Int {
        let hostURL = try nativeHostURL()
        let manifestData = try JSONSerialization.data(
            withJSONObject: [
                "name": nativeHostName,
                "description": "Antirot lockdown bridge",
                "path": hostURL.path,
                "type": "stdio",
                "allowed_origins": [
                    "chrome-extension://\(antiRotExtensionID)/"
                ]
            ],
            options: [.prettyPrinted, .sortedKeys]
        )

        var installedCount = 0
        for directory in nativeMessagingDirectories() {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let manifestURL = directory.appendingPathComponent(manifestFileName)
            try manifestData.write(to: manifestURL, options: .atomic)
            installedCount += 1
        }

        return installedCount
    }

    private static func nativeHostURL() throws -> URL {
        guard let executableDirectory = Bundle.main.executableURL?.deletingLastPathComponent() else {
            throw NativeMessagingInstallerError.missingExecutablePath
        }

        let hostURL = executableDirectory.appendingPathComponent("AntirotNativeHost")
        guard FileManager.default.fileExists(atPath: hostURL.path) else {
            throw NativeMessagingInstallerError.missingNativeHost(hostURL.path)
        }

        return hostURL
    }

    private static func nativeMessagingDirectories() -> [URL] {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return [
            appSupport.appendingPathComponent("Google/Chrome/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("Google/Chrome for Testing/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("Google/ChromeForTesting/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("BraveSoftware/Brave-Browser/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("Microsoft Edge/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("Chromium/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("Vivaldi/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("com.operasoftware.Opera/NativeMessagingHosts", isDirectory: true),
            appSupport.appendingPathComponent("net.imput.helium/NativeMessagingHosts", isDirectory: true)
        ]
    }
}

enum NativeMessagingInstallerError: LocalizedError {
    case missingExecutablePath
    case missingNativeHost(String)

    var errorDescription: String? {
        switch self {
        case .missingExecutablePath:
            return "Could not find the app executable path."
        case .missingNativeHost(let path):
            return "Could not find the native host at \(path)."
        }
    }
}

enum StateStore {
    private static var stateURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Antirot", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    static func load() throws -> AppState {
        let data = try Data(contentsOf: stateURL)
        return try JSONDecoder().decode(AppState.self, from: data)
    }

    static func save(_ state: AppState) throws {
        let directory = stateURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(state)
        try data.write(to: stateURL, options: .atomic)
    }
}

enum PolicyManager {
    private static let policyDirectory = URL(fileURLWithPath: "/Library/Managed Preferences", isDirectory: true)

    static func installedPolicyDomains(policyDomains: [String]) -> Set<String> {
        Set(policyDomains.compactMap { policyDomain in
            let url = policyDirectory.appendingPathComponent("\(policyDomain).plist")
            guard let data = try? Data(contentsOf: url),
                  let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
                  let dictionary = plist as? [String: Any],
                  let forceList = dictionary["ExtensionInstallForcelist"] as? [String],
                  forceList.contains(antiRotPolicyValue) else {
                return nil
            }
            return policyDomain
        })
    }

    static func applyProtection(to targets: [BrowserPolicyTarget]) throws {
        try runPrivilegedShell(makePolicyScript(action: "apply", targets: targets))
    }

    static func removeProtection(from targets: [BrowserPolicyTarget]) throws {
        try runPrivilegedShell(makePolicyScript(action: "remove", targets: targets))
    }

    private static func makePolicyScript(action: String, targets: [BrowserPolicyTarget]) -> String {
        let domains = targets.map(\.policyDomain).joined(separator: " ")

        return """
        #!/bin/sh
        set -eu

        ACTION='\(action)'
        POLICY_VALUE='\(antiRotPolicyValue)'
        POLICY_DIR='/Library/Managed Preferences'
        DOMAINS='\(domains)'

        PLIST_BUDDY='/usr/libexec/PlistBuddy'
        PLUTIL='/usr/bin/plutil'

        mkdir -p "$POLICY_DIR"

        ensure_plist() {
          plist="$1"
          if [ ! -f "$plist" ]; then
            "$PLUTIL" -create xml1 "$plist"
          fi

          if ! "$PLUTIL" -lint "$plist" >/dev/null 2>&1; then
            cp "$plist" "$plist.antirot-backup-$(date +%s)" 2>/dev/null || true
            "$PLUTIL" -create xml1 "$plist"
          fi

          chown root:wheel "$plist" 2>/dev/null || true
          chmod 644 "$plist" 2>/dev/null || true
        }

        apply_policy() {
          plist="$1"
          ensure_plist "$plist"

          if ! "$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" >/dev/null 2>&1; then
            "$PLIST_BUDDY" -c "Add :ExtensionInstallForcelist array" "$plist"
          fi

          if ! "$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" | /usr/bin/grep -F "$POLICY_VALUE" >/dev/null 2>&1; then
            "$PLIST_BUDDY" -c "Add :ExtensionInstallForcelist: string $POLICY_VALUE" "$plist"
          fi
        }

        remove_policy() {
          plist="$1"
          if [ ! -f "$plist" ]; then
            return 0
          fi

          if ! "$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" >/dev/null 2>&1; then
            return 0
          fi

          count=$("$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" | /usr/bin/awk '/^    / { c++ } END { print c + 0 }')
          i=$((count - 1))
          while [ "$i" -ge 0 ]; do
            item=$("$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist:$i" "$plist" 2>/dev/null || true)
            if [ "$item" = "$POLICY_VALUE" ]; then
              "$PLIST_BUDDY" -c "Delete :ExtensionInstallForcelist:$i" "$plist" >/dev/null 2>&1 || true
            fi
            i=$((i - 1))
          done

          remaining=$("$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" 2>/dev/null | /usr/bin/awk '/^    / { c++ } END { print c + 0 }')
          if [ "$remaining" -eq 0 ]; then
            "$PLIST_BUDDY" -c "Delete :ExtensionInstallForcelist" "$plist" >/dev/null 2>&1 || true
          fi
        }

        for domain in $DOMAINS; do
          plist="$POLICY_DIR/$domain.plist"
          case "$ACTION" in
            apply)
              apply_policy "$plist"
              ;;
            remove)
              remove_policy "$plist"
              ;;
            *)
              echo "Unknown action: $ACTION" >&2
              exit 2
              ;;
          esac
        done

        /usr/bin/killall cfprefsd >/dev/null 2>&1 || true
        echo "Antirot policy $ACTION complete."
        """
    }

    private static func runPrivilegedShell(_ script: String) throws {
        let scriptURL = try temporaryScriptURL()
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)
        defer {
            try? FileManager.default.removeItem(at: scriptURL)
        }

        let appleScript = #"do shell script "/bin/sh " & quoted form of "\#(scriptURL.path.appleScriptEscaped)" with administrator privileges"#
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", appleScript]

        let output = Pipe()
        let error = Pipe()
        process.standardOutput = output
        process.standardError = error

        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let message = String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw PolicyError.privilegedCommandFailed(message ?? "macOS rejected or cancelled the admin request.")
        }
    }

    private static func temporaryScriptURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Antirot", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("policy-\(UUID().uuidString).sh")
    }
}

enum PolicyError: LocalizedError {
    case privilegedCommandFailed(String)

    var errorDescription: String? {
        switch self {
        case .privilegedCommandFailed(let message):
            return message.isEmpty ? "macOS rejected or cancelled the admin request." : message
        }
    }
}

private extension String {
    var appleScriptEscaped: String {
        replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
