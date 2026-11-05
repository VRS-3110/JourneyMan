import AppKit

/// Starts the app. There is one window; closing it keeps JourneyMan running (click the Dock
/// icon to bring it back), and ⌘Q quits.
@main
enum JourneyManApp {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var browser: Browser?
    /// A journeyman:// link that arrived before the window was ready (it launched the app).
    private var pendingURL: URL?

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.make(target: self)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let browser = Browser()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "JourneyMan"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = browser.webView
        window.center()
        _ = window.setFrameAutosaveName("JourneyManMainWindow")
        window.makeKeyAndOrderFront(nil)
        self.window = window
        self.browser = browser
        browser.start(opening: pendingURL)
        pendingURL = nil
        NSApp.activate()
    }

    /// journeyman://localhost/index.html#task/<id> (Atlas's Open in JourneyMan), and sign-in links.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if let browser { browser.open(url) } else { pendingURL = url }
        }
        showWindow(nil)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    @objc func showWindow(_ sender: Any?) {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    @objc func reloadPage(_ sender: Any?) { browser?.webView.reload() }
    @objc func actualSize(_ sender: Any?) { browser?.webView.pageZoom = 1 }
    @objc func zoomIn(_ sender: Any?) {
        if let web = browser?.webView { web.pageZoom = min(web.pageZoom + 0.1, 2) }
    }
    @objc func zoomOut(_ sender: Any?) {
        if let web = browser?.webView { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }
    }

    @objc func openFolder(_ sender: Any?) {
        let folder = SharedFolder().base
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        NSWorkspace.shared.open(folder)
    }

    @objc func openHelp(_ sender: Any?) {
        NSWorkspace.shared.open(URL(string: "https://github.com/VRS-3110/JourneyMan#readme")!)
    }
}

/// The menu bar. Edit holds the standard text commands; the page still sees ⌘Z first, so
/// JourneyMan's own undo works when you're not typing.
@MainActor
enum MainMenu {
    static func make(target: AppDelegate) -> NSMenu {
        let bar = NSMenu()

        let app = menu("JourneyMan", in: bar)
        app.addItem(withTitle: "About JourneyMan", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide JourneyMan", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Quit JourneyMan", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let file = menu("File", in: bar)
        add(file, "Open JourneyMan Folder", #selector(AppDelegate.openFolder(_:)), "", target)
        file.addItem(.separator())
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let edit = menu("Edit", in: bar)
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let view = menu("View", in: bar)
        add(view, "Reload", #selector(AppDelegate.reloadPage(_:)), "r", target)
        view.addItem(.separator())
        add(view, "Actual Size", #selector(AppDelegate.actualSize(_:)), "0", target)
        add(view, "Zoom In", #selector(AppDelegate.zoomIn(_:)), "+", target)
        add(view, "Zoom Out", #selector(AppDelegate.zoomOut(_:)), "-", target)
        view.addItem(.separator())
        let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]

        let window = menu("Window", in: bar)
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(.separator())
        add(window, "JourneyMan", #selector(AppDelegate.showWindow(_:)), "1", target)
        NSApp.windowsMenu = window

        let help = menu("Help", in: bar)
        add(help, "JourneyMan Help", #selector(AppDelegate.openHelp(_:)), "", target)
        NSApp.helpMenu = help

        return bar
    }

    private static func menu(_ title: String, in bar: NSMenu) -> NSMenu {
        let item = bar.addItem(withTitle: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        return menu
    }

    private static func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String, _ target: AnyObject) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = target
    }
}
