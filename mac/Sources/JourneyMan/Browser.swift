import AppKit
import WebKit

/// The window's web view and everything a browser would normally do for the page: serving the
/// bundled files, opening outside links in their own apps, file pickers, downloads and
/// confirm dialogs.
///
/// The page is served from journeyman://localhost/, a scheme only this app answers, so its
/// data (IndexedDB) stays in this app and survives updates.
@MainActor
final class Browser: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let scheme = "journeyman"
    static let home = URL(string: "journeyman://localhost/index.html")!

    let webView: WKWebView
    private let files: AppFiles
    private let bridge: Bridge
    private var loaded = false
    private var pending: URL?

    override init() {
        let files = AppFiles()
        let bridge = Bridge()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.setURLSchemeHandler(files, forURLScheme: Self.scheme)
        let content = WKUserContentController()
        content.addScriptMessageHandler(bridge, contentWorld: .page, name: "journeyman")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        let marker = "window.journeymanApp = { platform: 'mac', version: '\(version)' };"
        content.addUserScript(WKUserScript(source: marker, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = content
        self.files = files
        self.bridge = bridge
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isInspectable = true // Safari ▸ Develop ▸ JourneyMan, for troubleshooting
    }

    /// Loads the app, at `url` if a link launched it.
    func start(opening url: URL?) {
        webView.load(URLRequest(url: url.flatMap(Self.appURL) ?? Self.home))
    }

    /// A journeyman:// link while the app is running. Task links change the page's address, which
    /// JourneyMan routes itself; anything else (a sign-in link) reloads the page with it.
    func open(_ url: URL) {
        guard let target = Self.appURL(url) else { return }
        guard loaded else { pending = target; return }
        let parts = target.absoluteString.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
        let fragment = parts.count > 1 ? String(parts[1]) : ""
        if fragment.hasPrefix("task/") {
            webView.evaluateJavaScript("location.hash = \(Self.jsString("#" + fragment));", completionHandler: nil)
        } else {
            webView.load(URLRequest(url: target))
        }
    }

    /// journeyman://… links point at this app's page whatever path they carry.
    static func appURL(_ url: URL) -> URL? {
        guard url.scheme?.lowercased() == scheme else { return nil }
        let parts = url.absoluteString.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
        return parts.count > 1 ? URL(string: home.absoluteString + "#" + parts[1]) : home
    }

    static func jsString(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.shouldPerformDownload { return .download }
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return .cancel }
        if [Self.scheme, "about", "blob", "data"].contains(scheme) { return .allow }
        // Notion, Atlas (atlas://), web pages and mail links open in their own apps.
        NSWorkspace.shared.open(url)
        return .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        if let pending {
            self.pending = nil
            open(pending)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loaded = false
        webView.reload()
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: Windows, dialogs and file pickers

    /// Links meant for a new window open in the browser instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        _ = alert.runModal()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        return panel.runModal() == .OK ? panel.urls : nil
    }

    // MARK: Downloads (backups, CSV, journeyman.json)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        try? FileManager.default.removeItem(at: url) // the panel already asked about replacing it
        return url
    }
}

/// Serves index.html, css/, js/ and icons/ from the app bundle (Contents/Resources/web).
@MainActor
final class AppFiles: NSObject, WKURLSchemeHandler {
    private let root: URL = (Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")).appendingPathComponent("web", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        let inside = file.path.hasPrefix(root.standardizedFileURL.path + "/")
        guard inside, let data = try? Data(contentsOf: file) else {
            let missing = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                          headerFields: ["Content-Type": "text/plain"])!
            urlSchemeTask.didReceive(missing)
            urlSchemeTask.didReceive(Data("Not found".utf8))
            urlSchemeTask.didFinish()
            return
        }
        let headers = ["Content-Type": Self.mimeType(file.pathExtension), "Content-Length": String(data.count),
                       "Cache-Control": "no-cache"]
        urlSchemeTask.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

    static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "json": "application/json"
        case "webmanifest": "application/manifest+json"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "ico": "image/x-icon"
        default: "application/octet-stream"
        }
    }
}
