# JourneyMan for Mac

A real Mac app for JourneyMan, in a DMG. You drag it to Applications, and it opens from the
Dock like any other app. There's no Terminal command to keep running, no browser, and it
works offline.

Inside, it's the same JourneyMan as the web version: the pages at the top of this repo,
in a native window. The app adds what a browser can't do:

| | In the Mac app |
| --- | --- |
| **Mac activity** | Read straight from `Documents/JourneyMan/activity`. No folder to connect. |
| **Atlas** | Uses `Documents/JourneyMan/atlas` by itself, and Atlas's **Open in JourneyMan** opens this app. |
| **Calendar** | The calendars on your Mac, the ones the Calendar app shows, instead of a Google sign-in. To include Google Calendar, add your Google account in System Settings ▸ Internet Accounts. Time blocks are added there too. |
| **Links** | Notion, Atlas and web links open in their own apps. Downloads (backups, CSV) ask where to save. |

## Make the DMG

You need macOS 14 or later and the Xcode Command Line Tools (`xcode-select --install`),
the same as for Atlas. In Terminal, from the JourneyMan folder:

```bash
mac/Scripts/make-dmg.sh
```

That builds `mac/build/JourneyMan-1.0.dmg`. Open it and drag JourneyMan onto Applications.

The first time you open it, macOS may say it can't check the app (it's signed on your Mac,
not by Apple). Go to System Settings ▸ Privacy & Security and choose **Open Anyway**.

Other scripts:

| Command | What it does |
| --- | --- |
| `mac/Scripts/run.sh` | Builds a quick debug copy and opens it |
| `mac/Scripts/build-app.sh release` | Builds `mac/build/JourneyMan.app` for Apple silicon and Intel |

After pulling a newer JourneyMan, run `make-dmg.sh` again and replace the app. Your data
stays.

## Moving your data in

The app keeps its own data, separate from Chrome or Safari.

1. In the browser version, open **Settings and backup** and choose **Export backup (JSON)**.
2. In the app, open **Settings and backup** and choose **Import backup…**.

Keys for the bridge and device sync aren't in backups, so enter those again in Connections.

Use one copy for each folder. If both the app and a Chrome tab share tasks with Atlas, they
take turns writing the same file.

## Connections that need one change

- **Bridge (Notion and Claude):** add `journeyman://localhost` to `ALLOWED_ORIGINS` in
  `worker/wrangler.toml`, then deploy again.
- **Device sync sign-in link:** add `journeyman://localhost/index.html` to Supabase's
  Redirect URLs. The emailed link then opens the app.

## How it works

| File | What it does |
| --- | --- |
| `Sources/JourneyMan/JourneyManApp.swift` | Starts the app, makes the window and the menus, and handles `journeyman://` links. Closing the window keeps the app running; ⌘Q quits. |
| `Sources/JourneyMan/Browser.swift` | The web view. It serves the bundled pages from `journeyman://localhost/`, opens other links outside, and handles file pickers, downloads and dialogs. |
| `Sources/JourneyMan/Bridge.swift` | What the page can ask for (`js/native.js`): files in `Documents/JourneyMan` (no other folder), and the Mac's calendars (EventKit). |
| `Resources/Info.plist` | Version, the `journeyman` link scheme, and why it asks for Calendars and Documents |
| `Scripts/` | Build, run and DMG, the same way as Atlas |

The page finds out it's in the app from `window.journeymanApp`.

For troubleshooting, Safari ▸ Develop ▸ JourneyMan opens the page's console. In Safari,
turn on Settings ▸ Advanced ▸ Show features for web developers.
