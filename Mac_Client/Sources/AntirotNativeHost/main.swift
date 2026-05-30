import Foundation

private let antiRotExtensionID = "emlpideklhedelfijihmafgnekgloddk"
private let chromeWebStoreUpdateURL = "https://clients2.google.com/service/update2/crx"
private let antiRotPolicyValue = "\(antiRotExtensionID);\(chromeWebStoreUpdateURL)"

@main
struct AntirotNativeHost {
    static func main() {
        do {
            let request = try NativeMessage.read()
            let response = try handle(request)
            try NativeMessage.write(response)
        } catch {
            try? NativeMessage.write([
                "ok": false,
                "error": error.localizedDescription
            ])
        }
    }

    private static func handle(_ request: [String: Any]) throws -> [String: Any] {
        guard let action = request["action"] as? String else {
            throw NativeHostError.invalidRequest
        }

        switch action {
        case "ping":
            return ["ok": true, "action": action]
        case "lockdownStarted":
            let loadedState = try? StateStore.load()
            var state = loadedState ?? .empty
            let policyDomains = targetPolicyDomains(from: loadedState)
            try PolicyManager.applyProtection(policyDomains: policyDomains)
            state.selectedPolicyDomains = policyDomains
            state.activePolicyDomains = policyDomains
            try StateStore.save(state)
            return [
                "ok": true,
                "action": action,
                "protected_browsers": policyDomains
            ]
        case "lockdownEnded":
            var state = (try? StateStore.load()) ?? .empty
            let policyDomains = cleanupPolicyDomains(from: state)
            try PolicyManager.removeProtection(policyDomains: policyDomains)
            state.activePolicyDomains = []
            try StateStore.save(state)
            return [
                "ok": true,
                "action": action,
                "protected_browsers": policyDomains
            ]
        default:
            throw NativeHostError.unknownAction(action)
        }
    }

    private static func targetPolicyDomains(from state: AppState?) -> [String] {
        if let state {
            return uniquePolicyDomains(state.selectedPolicyDomains)
        }

        let installed = BrowserPolicyTarget.knownTargets
            .filter(\.isInstalled)
            .map(\.policyDomain)
        return installed.isEmpty ? [BrowserPolicyTarget.knownTargets[0].policyDomain] : installed
    }

    private static func cleanupPolicyDomains(from state: AppState) -> [String] {
        uniquePolicyDomains(
            state.activePolicyDomains
                + state.selectedPolicyDomains
                + BrowserPolicyTarget.knownTargets.map(\.policyDomain)
        )
    }

    private static func uniquePolicyDomains(_ policyDomains: [String]) -> [String] {
        var seen = Set<String>()
        return policyDomains.filter { domain in
            guard isValidPolicyDomain(domain),
                  !seen.contains(domain) else {
                return false
            }
            seen.insert(domain)
            return true
        }
    }

    private static func isValidPolicyDomain(_ policyDomain: String) -> Bool {
        let pattern = #"^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$"#
        return policyDomain.range(of: pattern, options: .regularExpression) != nil
            && policyDomain.contains(".")
    }
}

enum NativeMessage {
    static func read() throws -> [String: Any] {
        let header = FileHandle.standardInput.readData(ofLength: 4)
        guard header.count == 4 else {
            throw NativeHostError.invalidMessageLength
        }

        let length = header.withUnsafeBytes { rawBuffer -> UInt32 in
            rawBuffer.load(as: UInt32.self).littleEndian
        }
        let payload = FileHandle.standardInput.readData(ofLength: Int(length))
        guard payload.count == Int(length) else {
            throw NativeHostError.invalidMessageLength
        }

        guard let message = try JSONSerialization.jsonObject(with: payload) as? [String: Any] else {
            throw NativeHostError.invalidRequest
        }
        return message
    }

    static func write(_ message: [String: Any]) throws {
        let payload = try JSONSerialization.data(withJSONObject: message)
        var length = UInt32(payload.count).littleEndian
        let header = Data(bytes: &length, count: 4)

        FileHandle.standardOutput.write(header)
        FileHandle.standardOutput.write(payload)
    }
}

struct BrowserPolicyTarget {
    let displayName: String
    let policyDomain: String
    let appPaths: [String]

    var isInstalled: Bool {
        appPaths.contains { FileManager.default.fileExists(atPath: $0) }
    }

    static let knownTargets: [BrowserPolicyTarget] = [
        BrowserPolicyTarget(
            displayName: "Google Chrome",
            policyDomain: "com.google.Chrome",
            appPaths: ["/Applications/Google Chrome.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Brave",
            policyDomain: "com.brave.Browser",
            appPaths: ["/Applications/Brave Browser.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Helium",
            policyDomain: "net.imput.helium",
            appPaths: ["/Applications/Helium.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Arc",
            policyDomain: "company.thebrowser.Browser",
            appPaths: ["/Applications/Arc.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Vivaldi",
            policyDomain: "com.vivaldi.Vivaldi",
            appPaths: ["/Applications/Vivaldi.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Opera",
            policyDomain: "com.operasoftware.Opera",
            appPaths: ["/Applications/Opera.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Opera GX",
            policyDomain: "com.operasoftware.OperaGX",
            appPaths: ["/Applications/Opera GX.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Microsoft Edge",
            policyDomain: "com.microsoft.Edge",
            appPaths: ["/Applications/Microsoft Edge.app"]
        ),
        BrowserPolicyTarget(
            displayName: "Chromium",
            policyDomain: "org.chromium.Chromium",
            appPaths: ["/Applications/Chromium.app"]
        )
    ]
}

struct AppState: Codable, Equatable {
    var selectedPolicyDomains: [String]
    var activePolicyDomains: [String]

    static let empty = AppState(selectedPolicyDomains: [], activePolicyDomains: [])

    init(selectedPolicyDomains: [String], activePolicyDomains: [String]) {
        self.selectedPolicyDomains = selectedPolicyDomains
        self.activePolicyDomains = activePolicyDomains
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyPolicyDomains = try container.decodeIfPresent(
            [String].self,
            forKey: .policyDomains
        )
        selectedPolicyDomains = try container.decodeIfPresent(
            [String].self,
            forKey: .selectedPolicyDomains
        ) ?? legacyPolicyDomains ?? []
        activePolicyDomains = try container.decodeIfPresent(
            [String].self,
            forKey: .activePolicyDomains
        ) ?? legacyPolicyDomains ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(selectedPolicyDomains, forKey: .selectedPolicyDomains)
        try container.encode(activePolicyDomains, forKey: .activePolicyDomains)
    }

    private enum CodingKeys: String, CodingKey {
        case selectedPolicyDomains
        case activePolicyDomains
        case policyDomains
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
    static func applyProtection(policyDomains: [String]) throws {
        guard !policyDomains.isEmpty else { return }
        try runPrivilegedShell(makePolicyScript(action: "apply", policyDomains: policyDomains))
    }

    static func removeProtection(policyDomains: [String]) throws {
        guard !policyDomains.isEmpty else { return }
        try runPrivilegedShell(makePolicyScript(action: "remove", policyDomains: policyDomains))
    }

    private static func makePolicyScript(action: String, policyDomains: [String]) -> String {
        let domains = policyDomains.joined(separator: " ")
        let consoleUser = NSUserName().shellSingleQuoted

        return """
        #!/bin/sh
        set -eu

        ACTION='\(action)'
        EXTENSION_ID='\(antiRotExtensionID)'
        POLICY_VALUE='\(antiRotPolicyValue)'
        UPDATE_URL='\(chromeWebStoreUpdateURL)'
        POLICY_DIR='/Library/Managed Preferences'
        CONSOLE_USER=\(consoleUser)
        DOMAINS='\(domains)'

        PLIST_BUDDY='/usr/libexec/PlistBuddy'
        PLUTIL='/usr/bin/plutil'

        mkdir -p "$POLICY_DIR"
        if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ]; then
          USER_POLICY_DIR="$POLICY_DIR/$CONSOLE_USER"
          mkdir -p "$USER_POLICY_DIR"
        else
          USER_POLICY_DIR=""
        fi

        ensure_plist() {
          plist="$1"
          mkdir -p "$(dirname "$plist")"

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

          if ! "$PLIST_BUDDY" -c "Print :ExtensionSettings" "$plist" >/dev/null 2>&1; then
            "$PLIST_BUDDY" -c "Add :ExtensionSettings dict" "$plist"
          fi

          if "$PLIST_BUDDY" -c "Print :ExtensionSettings:$EXTENSION_ID" "$plist" >/dev/null 2>&1; then
            "$PLIST_BUDDY" -c "Delete :ExtensionSettings:$EXTENSION_ID" "$plist" >/dev/null 2>&1 || true
          fi
          "$PLIST_BUDDY" -c "Add :ExtensionSettings:$EXTENSION_ID dict" "$plist"
          "$PLIST_BUDDY" -c "Add :ExtensionSettings:$EXTENSION_ID:installation_mode string force_installed" "$plist"
          "$PLIST_BUDDY" -c "Add :ExtensionSettings:$EXTENSION_ID:update_url string $UPDATE_URL" "$plist"
        }

        remove_policy() {
          plist="$1"
          if [ ! -f "$plist" ]; then
            return 0
          fi

          if "$PLIST_BUDDY" -c "Print :ExtensionInstallForcelist" "$plist" >/dev/null 2>&1; then
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
          fi

          if "$PLIST_BUDDY" -c "Print :ExtensionSettings:$EXTENSION_ID" "$plist" >/dev/null 2>&1; then
            "$PLIST_BUDDY" -c "Delete :ExtensionSettings:$EXTENSION_ID" "$plist" >/dev/null 2>&1 || true
          fi

          if "$PLIST_BUDDY" -c "Print :ExtensionSettings" "$plist" >/dev/null 2>&1; then
            if ! "$PLIST_BUDDY" -c "Print :ExtensionSettings" "$plist" | /usr/bin/grep -q '^    '; then
              "$PLIST_BUDDY" -c "Delete :ExtensionSettings" "$plist" >/dev/null 2>&1 || true
            fi
          fi
        }

        for domain in $DOMAINS; do
          case "$ACTION" in
            apply)
              apply_policy "$POLICY_DIR/$domain.plist"
              if [ -n "$USER_POLICY_DIR" ]; then
                apply_policy "$USER_POLICY_DIR/$domain.plist"
              fi
              ;;
            remove)
              remove_policy "$POLICY_DIR/$domain.plist"
              if [ -n "$USER_POLICY_DIR" ]; then
                remove_policy "$USER_POLICY_DIR/$domain.plist"
              fi
              ;;
            *)
              echo "Unknown action: $ACTION" >&2
              exit 2
              ;;
          esac
        done

        /usr/bin/killall cfprefsd >/dev/null 2>&1 || true
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

        let error = Pipe()
        process.standardOutput = Pipe()
        process.standardError = error

        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let message = String(data: error.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw NativeHostError.privilegedCommandFailed(message ?? "macOS rejected or cancelled the admin request.")
        }
    }

    private static func temporaryScriptURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Antirot", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("policy-\(UUID().uuidString).sh")
    }
}

enum NativeHostError: LocalizedError {
    case invalidMessageLength
    case invalidRequest
    case unknownAction(String)
    case privilegedCommandFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidMessageLength:
            return "Invalid native-message length."
        case .invalidRequest:
            return "Invalid native-message request."
        case .unknownAction(let action):
            return "Unknown native-message action: \(action)."
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

    var shellSingleQuoted: String {
        "'\(replacingOccurrences(of: "'", with: "'\\''"))'"
    }
}
