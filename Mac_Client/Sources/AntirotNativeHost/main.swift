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
            let policyDomains = targetPolicyDomains()
            try PolicyManager.applyProtection(policyDomains: policyDomains)
            try StateStore.save(AppState(policyDomains: policyDomains))
            return [
                "ok": true,
                "action": action,
                "protected_browsers": policyDomains
            ]
        case "lockdownEnded":
            let policyDomains = targetPolicyDomains()
            try PolicyManager.removeProtection(policyDomains: policyDomains)
            return [
                "ok": true,
                "action": action,
                "protected_browsers": policyDomains
            ]
        default:
            throw NativeHostError.unknownAction(action)
        }
    }

    private static func targetPolicyDomains() -> [String] {
        if let saved = try? StateStore.load() {
            return saved.policyDomains
        }

        let installed = BrowserPolicyTarget.knownTargets
            .filter(\.isInstalled)
            .map(\.policyDomain)
        return installed.isEmpty ? [BrowserPolicyTarget.knownTargets[0].policyDomain] : installed
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
    let policyDomains: [String]

    static let empty = AppState(policyDomains: [])
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
        try runPrivilegedShell(makePolicyScript(action: "apply", policyDomains: policyDomains))
    }

    static func removeProtection(policyDomains: [String]) throws {
        try runPrivilegedShell(makePolicyScript(action: "remove", policyDomains: policyDomains))
    }

    private static func makePolicyScript(action: String, policyDomains: [String]) -> String {
        let domains = policyDomains.joined(separator: " ")

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
}
