import AppKit
import EventKit
import WebKit

/// Answers the page's `webkit.messageHandlers.journeyman.postMessage({ op, … })` calls
/// (js/native.js). Each call gets a reply, so it is a promise on the page.
///
///     fs.stat / fs.read / fs.write / fs.mkdir   paths inside ~/Documents/JourneyMan
///     calendar.access / list / events / create / delete
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    private let folder = SharedFolder()
    private let calendar = CalendarBridge()

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) async -> (Any?, String?) {
        // Only the app's own page may ask.
        guard message.frameInfo.request.url?.scheme?.lowercased() == Browser.scheme else {
            return (nil, "Not allowed.")
        }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return (nil, "That request isn't understood.")
        }
        do {
            return (try await handle(op, Arguments(body)), nil)
        } catch let error as BridgeError {
            return (nil, error.message)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    private func handle(_ op: String, _ a: Arguments) async throws -> Any {
        switch op {
        case "fs.stat": return try folder.stat(a.string("path"))
        case "fs.read": return try folder.read(a.string("path"))
        case "fs.write": try folder.write(a.string("path"), text: a.string("text")); return NSNull()
        case "fs.mkdir": try folder.makeFolder(a.string("path")); return NSNull()
        case "calendar.access": return await calendar.access()
        case "calendar.list": return try calendar.calendars()
        case "calendar.events":
            return try calendar.events(calendarID: a.string("calendarId"), from: a.date("from"), to: a.date("to"))
        case "calendar.create":
            let link = a.optionalString("url").flatMap { $0.isEmpty ? nil : URL(string: $0) }
            return try calendar.create(calendarID: a.optionalString("calendarId") ?? "", title: a.string("title"),
                                       notes: a.optionalString("notes") ?? "", start: a.date("start"),
                                       end: a.date("end"), url: link)
        case "calendar.delete": try calendar.delete(id: a.string("id")); return true
        default: throw BridgeError("Unknown request: \(op)")
        }
    }
}

struct BridgeError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// Typed access to a request's fields.
struct Arguments {
    let values: [String: Any]
    init(_ values: [String: Any]) { self.values = values }

    func string(_ key: String) throws -> String {
        guard let value = values[key] as? String else { throw BridgeError("Missing \(key).") }
        return value
    }

    func optionalString(_ key: String) -> String? { values[key] as? String }

    func date(_ key: String) throws -> Date {
        guard let date = ISODates.parse(try string(key)) else { throw BridgeError("\(key) isn't a date.") }
        return date
    }
}

/// ISO 8601 as JavaScript writes it, with or without milliseconds.
enum ISODates {
    static func formatter(fractional: Bool) -> ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return f
    }

    static func parse(_ text: String) -> Date? {
        formatter(fractional: true).date(from: text) ?? formatter(fractional: false).date(from: text)
    }

    static func string(_ date: Date) -> String {
        formatter(fractional: true).string(from: date)
    }
}

/// ~/Documents/JourneyMan: the Mac helper's activity/ folder and Atlas's atlas/ folder.
/// Paths from the page are relative to it and can't leave it.
struct SharedFolder {
    let base: URL = (FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Documents", isDirectory: true))
        .appendingPathComponent("JourneyMan", isDirectory: true)

    func resolve(_ path: String) throws -> URL {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw BridgeError("That path isn't allowed: \(path)")
        }
        return parts.reduce(base) { $0.appendingPathComponent($1) }
    }

    func stat(_ path: String) throws -> [String: Any] {
        let url = try resolve(path)
        guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey]) else {
            return ["exists": false, "isDir": false]
        }
        var info: [String: Any] = ["exists": true, "isDir": values.isDirectory ?? false]
        if let modified = values.contentModificationDate { info["mtime"] = modified.timeIntervalSince1970 * 1000 }
        return info
    }

    func read(_ path: String) throws -> [String: Any] {
        let url = try resolve(path)
        guard let data = try? Data(contentsOf: url) else { throw BridgeError("\(path) doesn't exist.") }
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
        return ["text": String(decoding: data, as: UTF8.self), "mtime": modified.timeIntervalSince1970 * 1000]
    }

    func write(_ path: String, text: String) throws {
        let url = try resolve(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url, options: .atomic)
    }

    func makeFolder(_ path: String) throws {
        try FileManager.default.createDirectory(at: try resolve(path), withIntermediateDirectories: true)
    }
}

/// The Mac's calendars through EventKit: whatever the Calendar app shows, Google accounts
/// added in System Settings included. Events are described in the plain shape js/native.js
/// turns into Google Calendar events.
@MainActor
final class CalendarBridge {
    private var store = EKEventStore()

    /// "granted" or "denied". Asks the first time; macOS remembers the answer.
    func access() async -> String {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess:
            return "granted"
        case .notDetermined:
            let granted = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
                store.requestFullAccessToEvents { granted, _ in done.resume(returning: granted) }
            }
            if granted { store = EKEventStore() } // a fresh store sees the calendars just allowed
            return granted ? "granted" : "denied"
        default:
            return "denied"
        }
    }

    private func requireAccess() throws {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw BridgeError("JourneyMan can’t see your calendars. Turn it on in System Settings ▸ Privacy & Security ▸ Calendars.")
        }
    }

    func calendars() throws -> [[String: Any]] {
        try requireAccess()
        let preferred = store.defaultCalendarForNewEvents?.calendarIdentifier
        return store.calendars(for: .event).map { calendar in
            [
                "id": calendar.calendarIdentifier,
                "title": calendar.title,
                "color": Self.hex(calendar.color) ?? "",
                "isDefault": calendar.calendarIdentifier == preferred,
                "writable": calendar.allowsContentModifications,
            ]
        }
    }

    func events(calendarID: String, from: Date, to: Date) throws -> [[String: Any]] {
        try requireAccess()
        guard let calendar = store.calendar(withIdentifier: calendarID) else { return [] }
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: [calendar])
        return store.events(matching: predicate).map(describe)
    }

    func create(calendarID: String, title: String, notes: String, start: Date, end: Date, url: URL?) throws -> [String: Any] {
        try requireAccess()
        let target = calendarID.isEmpty ? store.defaultCalendarForNewEvents : store.calendar(withIdentifier: calendarID)
        guard let target else { throw BridgeError("There's no calendar to add the time block to.") }
        guard target.allowsContentModifications else { throw BridgeError("“\(target.title)” can’t be changed. Choose another calendar for time blocks.") }
        let event = EKEvent(eventStore: store)
        event.calendar = target
        event.title = title
        event.notes = notes.isEmpty ? nil : notes
        event.startDate = start
        event.endDate = end
        event.url = url
        event.availability = .busy
        try store.save(event, span: .thisEvent, commit: true)
        return describe(event)
    }

    func delete(id: String) throws {
        try requireAccess()
        guard let event = store.event(withIdentifier: id) else { return } // already gone
        try store.remove(event, span: .thisEvent, commit: true)
    }

    private func describe(_ event: EKEvent) -> [String: Any] {
        let start: Date = event.startDate ?? Date()
        let end: Date = event.endDate ?? start
        var info: [String: Any] = [
            "id": event.eventIdentifier ?? event.calendarItemIdentifier,
            "title": event.title ?? "",
            "start": ISODates.string(start),
            "end": ISODates.string(end),
            "allDay": event.isAllDay,
            "free": event.availability == .free,
            "cancelled": event.status == .canceled,
            "declined": event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false,
        ]
        if event.isAllDay {
            // Google style: the day after the last one.
            let calendar = Calendar.current
            let lastDay = calendar.startOfDay(for: end.addingTimeInterval(-1))
            info["startDay"] = Self.dayKey(calendar.startOfDay(for: start))
            info["endDay"] = Self.dayKey(calendar.date(byAdding: .day, value: 1, to: max(lastDay, calendar.startOfDay(for: start))) ?? end)
        }
        if let url = event.url { info["url"] = url.absoluteString }
        return info
    }

    static func dayKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func hex(_ color: NSColor?) -> String? {
        guard let rgb = color?.usingColorSpace(.sRGB) else { return nil }
        let r = Int((rgb.redComponent * 255).rounded()), g = Int((rgb.greenComponent * 255).rounded()), b = Int((rgb.blueComponent * 255).rounded())
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
