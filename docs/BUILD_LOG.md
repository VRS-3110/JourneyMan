# JourneyMan build log

What was built in each phase, how it was checked and what is left. Newest last.

## Phase 1: Capture and organise (4 Nov 2026)

- Quick add with a parser for `#project`, `@area`, `~estimates`, dates, times, `due` deadlines, `!` priority and Notion links, plus a live preview.
- Inbox, Today (with a capacity bar), Upcoming, Anytime and Logbook views. Areas → projects → tasks.
- Detail pane, ⌘K search, keyboard shortcuts and undo.
- Notion links on tasks, projects and areas, opened in the Notion app. Import of a Notion database from its CSV export.
- IndexedDB storage, JSON backup, offline service worker.
- **Fix:** with two date phrases, the last one wins. "Plan next week sun" is now "Plan next week" on Sunday.
- **Checked:** 24 unit tests, plus an end-to-end browser run at 1440×900 in light and dark mode with no console errors.

## Phase 2: Time tracking (4 Nov 2026)

- **Time entries** are a new record type: `{ taskId, start, end, deep, source: timer|manual, note }`. The IndexedDB schema moved to version 2 and upgrades in place.
- **Every record now has `updatedAt`**, and deletes leave tombstones. Phases 4 and 5 need both for sync.
- **Timer:** one runs at a time, and starting one stops the other.
  - Start it from a task row's ▶, from the detail pane, or with `S` on the selected task. `S` with nothing selected stops the running timer.
  - The running timer is pinned in the sidebar, with a live clock, a deep-work toggle and a Stop button. The window title shows the clock.
  - Runs under a minute are treated as mis-clicks and dropped.
  - After 3 hours it asks "Still working?" with Yes, Stop at 3h or Discard.
- **Manual logging** in the detail pane: type `45m` or `1h30m` and pick a day. The pane lists the task's entries, each with a deep-work tag and a delete button with undo.
- **Tasks show tracked against estimated time** (e.g. `1h 10m / 1h`), in red when over.
- **Today has a recap:** tracked time, deep work, tasks done, time by project, and planned against actual time for tasks finished today.
- **New Time view** (`G` then `M`):
  - Weekly tiles: tracked, deep work, tasks done, and your estimate multiplier.
  - Stacked daily hours by area, with hover tooltips.
  - A by-project table, the biggest gaps between plan and reality, and week navigation.
  - CSV export for one week, or for everything from Settings.
- **Estimate multiplier:** actual ÷ estimated time over your last 30 finished tasks, once at least 3 exist. Settings has a toggle to adjust estimates by it, which phase 3 uses.
- **Area colours** moved to a validated, colour-blind-checked palette of 8 slots, each with its own light and dark step. The old colours failed the palette check (two read as grey, and one pair was too close in normal vision). Saved colours are mapped to the nearest slot automatically.
- **Checked:** 29 unit tests (5 new: timer rules, manual logs, undo, multiplier, reports, CSV). A browser run with a fake clock covered starting and stopping, logging, deep work, the 3-hour prompt, the recap, chart tooltips, CSV download and data surviving a reload. No console errors.

## Phase 3: Visualise (4 Nov 2026)

- **New `js/insights.js`:** plain, explainable rules with no AI and no network. Every number comes with its reason.
- **Next up on Today:** the top 3 tasks, ranked by `3·urgency + 2·importance + fit + staleness`, each part from 0 to 1:
  - **Urgency:** how close the deadline is, the task's own or its project's, over 14 days, or a planned day that has arrived.
  - **Importance:** priority, plus a lift when the project's deadline is within 3 weeks.
  - **Fit:** whether the estimate, adjusted by your multiplier, fits the time left today (your hours minus what you've tracked).
  - **Staleness:** how long the project has been untouched, over 14 days.
  - Each suggestion shows its reasons (e.g. "Project due Sat · Priority ! · Fits in your 6h left"), and has a Start button that starts the timer.
  - A filter for the time you have: Any, 15m, 30m, 1h or 2h.
- **Project health** with an icon and a label, never colour alone:
  - **Overdue:** the deadline has passed with work open.
  - **Stalled:** nothing done or tracked for 14 days.
  - **No next action:** the project has no open task.
  - **At risk:** the work left needs more than half your day until the deadline, or your 14-day pace won't finish it.
  - **On track:** none of the above.
  - Health shows on project cards, in the project header (with the reason) and in Insights.
- **New Insights view** (`G` then `S`):
  - Projects that need attention.
  - A 4-week workload forecast: planned hours against hours available, with ⚠ over-capacity notes. Estimates are adjusted by your multiplier, and tasks without an estimate count as 30m. Tasks with only a deadline are spread over the days left.
  - 8 weeks of time by area, against weekly targets you set on each area page.
  - A focus heatmap: tracked minutes by weekday and hour over 4 weeks.
  - An urgent/important 2×2 of open tasks. Click a dot to open the task.
  - An estimate check per project.
- Charts follow the colour checks: area colours from the validated palette, a 2px gap between stacked segments, rounded bar tops on a square baseline, a legend for 2 or more series, and a tooltip on hover and keyboard focus. The heatmap uses one blue scale.
- **Fixes found in testing:**
  - Tasks opened from search, a chart dot or the timer bar now open reliably. The page change used to clear the selection.
  - Overlapping dots in the matrix spread out so each one can be clicked.
  - The forecast tooltip no longer shows a redundant "Total" row.
  - The time chart's axis ticks are whole hours.
- **Checked:** 38 unit tests (9 new for ranking, health states, the stalled and slow-pace cases, the forecast, the focus grid, the matrix and accuracy). The browser run used a month of generated history and covered Next up with its filter, health, every chart with tooltips, clicking from the matrix to a task, and dark mode. No console errors.

## Phase 4: Notion bridge, weekly review and Mac day journal (4 Nov 2026)

### Notion bridge

- **`worker/`:** a Cloudflare Worker that holds `NOTION_TOKEN` and, from phase 5, `ANTHROPIC_API_KEY`.
  - It forwards only the six Notion calls JourneyMan makes.
  - It checks an `APP_KEY` with a constant-time comparison, and restricts which websites may call it (`ALLOWED_ORIGINS`).
  - Notion API version 2022-06-28, which can be changed with `NOTION_VERSION`.
  - Deploy steps are in `worker/README.md`. I couldn't deploy it myself, because that needs your Cloudflare account and Notion secret.
- **`js/notion.js`:** linking a Notion database to a project.
  - Fields are matched automatically from property names and types: title, Status (status, select or checkbox) with its done and not-done values, Due, Est. hours or minutes, Notes, and a "Time spent" number for writing tracked time back. You can change any of them before linking.
  - Status is written only when done-ness changes, so an in-progress status like "Studying" isn't overwritten.
- **Two-way sync:**
  - When only one side changed, that change wins. When both changed, the newer edit wins and it counts as a conflict.
  - New pages become tasks, and new tasks become pages.
  - A task deleted here archives its page in Notion, using the Notion id kept on the deleted task's tombstone.
  - A page removed in Notion removes the task here if it's unchanged since the last sync. Otherwise the task is unlinked and kept.
  - Tracked time is written to Notion when it changes.
  - Sync runs on demand, or every 10 minutes while JourneyMan is open.
- **Notion journal:** a database with a title and a date. JourneyMan adds a "From JourneyMan" section to that day's page, creating the page if needed. Both day journals and weekly reviews can be sent there.

### Weekly review

- **New Review view**, marked DUE in the sidebar once 7 days have passed. It has six steps:
  1. Empty the inbox.
  2. Check every project, from health.
  3. Look back at last week: tracked time, deep work, tasks done, biggest miss.
  4. Look ahead at next week's workload and the deadlines in the next 14 days.
  5. Tidy up: archive completed projects and look at Someday projects.
  6. Reflect: write notes.
- **Finish review** logs it, keeps a streak (the phase 4 gate is three weeks in a row), and can add a summary to the Notion journal.

### Mac activity → day journal (asked for during phase 3)

- **`mac-agent/`:** a helper script, a launchd agent and install/uninstall scripts.
  - Every 30 seconds it records the app in front, its window title and your idle time to `~/Documents/JourneyMan/activity/YYYY-MM-DD.jsonl`.
  - Nothing is recorded while the screen is locked. Excluded apps are recorded as "Private". `TITLES=0` records app names only, and `PAUSED=1` stops recording.
  - It uses only built-in macOS tools: bash, osascript with JavaScript for Automation, and ioreg.
- **`js/activity.js`:**
  - Samples are merged into sessions. Idle time, gaps and ignored apps are dropped.
  - Each session is matched by your rules first, then by a task name (or its core, without "(…)" or what follows a colon), a project name or an area name in the window title.
  - Output: a day summary, planned against actual, a plain-words journal entry, and moving unfinished tasks forward.
  - Matched activity becomes time entries. They skip time already covered by timers, and re-running replaces rather than double counts.
- Time entries can now belong to a project or area with no task. Reports, project totals and charts all count them.
- **New Journal view:**
  - A day timeline coloured by area, with tooltips.
  - "Where the time went", and "Not matched yet" with **Assign…**, which adds a rule.
  - Plan against reality, with a one-click "Move unfinished to tomorrow" and undo.
  - An editable journal entry with notes: save it, add matched time to Time, or send it to Notion.
  - Activity comes in from a connected folder (Chrome, re-read on open) or an imported `.jsonl` file (any browser).
- **New Connections view:** bridge URL and key with a connection test, linked databases with their last result, the journal database, matching rules and ignored apps.

### Fixes found in testing

- Typing into a settings field re-drew the form and lost what you'd typed in the next field. Typed settings now save without a redraw.
- A window title didn't match a task with a bracketed suffix. Matching now also tries the task name without it.
- Assign put an area's projects before the area itself. The area now comes first.
- Done tasks pulled from Notion were dated by the sync. They're now dated by Notion's edit time, so they don't count as done today.
- Matched time with no area used Work's blue on the timeline. It now has its own grey and its own legend entry.

### Checked

- **Unit tests:** 49 in all. New ones cover mapping, page ↔ task conversion, a full two-way sync against an in-memory Notion (pull, push, create both ways, time write-back, archive, removal, no-op), a conflict, the API caller, writing the journal, sessions, matching, summaries, double-counting protection, planned against actual, the journal text and moving tasks forward. Also 3 tests for the bridge: key, origin, allowed routes and token.
- **Browser run:** the real worker code ran on Node, with Notion replaced by an in-memory fake. The run covered connecting, looking up and linking a database, sync in both directions, setting the journal database, importing a day of activity, assigning, adding time, saving the journal and sending it to Notion, and finishing a review with the summary sent to Notion. No console errors.
- **Mac helper:** syntax-checked. Its JavaScript was checked under Node with a simulated System Events. It hasn't run on a real Mac yet, because this machine is Linux.

## Phase 5: Sync and AI (4 Nov 2026)

### Claude, through your bridge

- **`worker/src/ai.js`** uses the official Anthropic TypeScript SDK (`@anthropic-ai/sdk` 1.4.0, pinned).
  - **Model:** Claude Opus 5.5 (`claude-opus-5-5`), which can be changed with `CLAUDE_MODEL`.
  - **Effort:** `low` for quick extraction and picks, `medium` for writing and planning. Thinking is always on for this model, and effort is the control.
  - **Structured outputs:** every answer is constrained to a strict JSON schema (`output_config.format`).
  - **Refusal fallback:** `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If Claude declines a request, Anthropic's recommended fallback model answers it in the same call. A full refusal is reported as one.
  - **Errors:** the SDK's typed errors become readable messages. The SDK retries rate limits and server errors twice on its own.
  - **No prompt caching.** Each prompt is shorter than the minimum the cache accepts.
- **Five features, each its own route** (`/ai/plan`, `/ai/breakdown`, `/ai/now`, `/ai/journal`, `/ai/review`), so the bridge can't be used as a general Claude proxy:
  - **✨ Brain dump:** next to quick add. A messy paragraph becomes tasks with projects, areas, dates, estimates and priority, and you tick which to add.
  - **Suggest next steps:** on a project page, 3 to 7 steps.
  - **Ask Claude:** in Next up. You give the minutes you have and your energy, and it picks from your ranked candidates, with a reason and a first step. Start begins the timer.
  - **Write with Claude:** in the Journal, a first-person entry drafted from the day's facts and your notes.
  - **Draft with Claude:** in the weekly review, a reflection plus 2 or 3 focuses for next week.
- The AI buttons appear only once **Test connection** shows Claude is set up on the bridge. Connections says exactly what is sent to Anthropic.

### Sync across devices (Supabase)

- **`supabase/schema.sql`:** one `records` table with row-level security, so each user sees only their rows.
  - `push_records()` replaces a row only when the incoming one is strictly newer, so an old device can't overwrite newer edits and echoing a record back changes nothing.
  - A server-side timestamp acts as the pull cursor, so differences between device clocks don't matter.
- **`js/sync.js`:** offline-first. Each round pushes what changed here since the last push, including deletions (tombstones) and shared settings, then pulls what changed elsewhere.
  - The newer edit wins on both sides.
  - Times are compared as instants, because Postgres writes `+00:00` and the app writes `Z`.
- **Sign-in** uses an email code, or the email link on the same device. The code is what lets you sign in inside the installed app.
- **On a device that already has tasks**, signing in asks whether to merge them with your synced data or replace them with it.
- **Sync runs** every 2 minutes, 20 seconds after a change, when the app comes back into view, and when you come back online.
- **Kept per device:** keys, the session and Mac activity.

### Phone layout

- The lists become a scrollable tab strip at the top.
- The detail pane goes full screen.
- Touch targets are larger and the play button is always visible.
- Forms fit one column.
- Checked on an iPhone 14 size: no sideways scrolling.

### Fixes found in testing

- The brain-dump list stacked its chips vertically. A style rule meant for list rows was catching them.
- Sync compared time strings. That would have mis-ordered times written as `…+00:00` against `…Z`. It now compares instants, with a test for the Postgres format.

### Checked

- **Unit tests:** 58 in all. New ones cover the strict AI schemas, the request shape (model, effort, fallback, beta header, structured output), refusals, API errors, unknown routes and missing keys, two devices staying in step (create, edit, delete, prefs, a quiet round), an older edit losing, the Postgres time format, and sign-in sessions with refresh.
- **Browser run, part 1:** the real bridge code ran on Node with a fake Claude, plus a fake Supabase. It covered connecting the bridge, Brain dump (choose, then add), Suggest next steps, Ask Claude and start the timer, the journal draft and the review draft. All 10 Claude calls used `claude-opus-5-5`, `fallbacks: "default"`, and low or medium effort.
- **Browser run, part 2:** the Mac signed in and merged its tasks. The phone (iPhone 14 size) signed in and replaced its starter data, ending with the same task count as the Mac. A task completed on the phone showed as done on the Mac after syncing. No console errors.
- **Not tested against the real services**, because they need your accounts: Cloudflare, Notion, Anthropic, Supabase and the Mac helper on a real Mac. Each one's README has the setup steps, and Connections has a test button for the bridge.

## After phase 5: Repeating tasks and Google Calendar (5 Nov 2026)

### Repeating tasks

- **`js/recurrence.js`:** rules every n days, weeks, months or years.
  - Weekly repeats can be on chosen weekdays.
  - Monthly and yearly repeats keep their day, landing on the 28th or 29th of shorter months, and 29 February moves to the 28th.
  - Fortnightly repeats on chosen days stay on the right weeks.
  - Optional "count from when I finish" and an end date.
- **Quick add** understands `every mon wed fri`, `every mon and thu`, `every weekday`, `every weekend`, `every 3 days`, `every other week`, `every 2 weeks on fri`, `every month`, `every year`, `daily`, `weekly`, `fortnightly`, `monthly`, `yearly` and `weekdays`. "Every word" stays text.
  - A new repeating task starts on the first matching day ("every mon" typed on a Wednesday starts next Monday).
  - A repeating deadline ("every month due 30th") goes by the deadline.
- **Finishing one creates the next.**
  - The deadline keeps its gap from the date.
  - Overdue series skip ahead to today instead of piling up copies.
  - The next task's id is the series id plus its date, so two devices finishing the same one offline sync to a single next task.
  - Undo and un-ticking remove the next task if it hasn't been touched.
- **In the interface:**
  - A ↻ chip on the row.
  - A Repeat control in the details: presets plus a custom editor for every n units, weekday toggles, "from when I finish" and an end date.
  - Upcoming repeats shown faintly in Upcoming.
  - Future repeats counted in the workload forecast.

### Google Calendar

- **Connection:** no server. Google Identity Services runs in the browser with your own OAuth client ID (`docs/GOOGLE_CALENDAR.md`). The Calendar API is called directly, with the calendar-list read-only scope and the events scope (events are only written for time blocks).
- **What's read:** the next 4 weeks, from the calendars you choose. Cancelled events, declined invitations and events marked "free" don't count. Time blocks made from JourneyMan aren't counted as meetings, because the task's estimate already counts.
- **Where meetings show up:**
  - Today's hours bar ("4h 45m free: 6h minus 1h 15m of meetings").
  - Free time in Next up, with a new reason, "Fits before Supervisor meeting at 14:00".
  - The workload forecast, per week.
  - Upcoming day headers.
  - The journal entry ("Meetings: 1h 15m (Standup, Supervisor meeting).").
  - A "Calendar today" card on Today.
- **Block time** finds the first free slot of the task's estimate (or 30m) in your work hours, today or the next 6 days, and creates the event. It sets the task's day and time, and Remove deletes the event.
- **Sign-in:** tokens last about an hour, refresh every 15 minutes while valid, and are kept on this device. When one runs out, the last events read are used until you choose Refresh. Events aren't exported or synced.

### Fixes found in testing

- A time block was counted as a meeting on top of the task's own estimate, so Today undercounted your free time.
- "Pay rent every month due nov 30" typed in Today got today as its date. A repeating deadline now keeps no date.
- Undoing an un-tick restored a copy of the task whose next one had been removed. It now completes the task again, which recreates the same next one.

### Checked

- **Unit tests:** 70 in all, 12 new:
  - Parsing, next dates (month ends, leap years, end dates, fortnights) and descriptions.
  - Creating the next task, and undo.
  - Counting from when you finish, overdue series, and the deadline gap.
  - `setRepeat` and upcoming repeats, the forecast, and two devices finishing the same task.
  - Normalising calendar events, merging busy time, meeting minutes, the next meeting, free slots, slots that roll over to the next day, and blocks not counting as meetings.
  - Meetings in capacity, free time, Next up, the forecast and the journal.
- **Browser run:** with a fake Google sign-in and Calendar API, plus a fake clock. It covered typing a repeat and seeing the preview, finishing one and getting the next on Friday, upcoming repeats, un-ticking removing the next one, the custom repeat editor, connecting the calendar (list plus 2 calendars read), meetings in the hours bar, the Today card and Next up, blocking time (POST) and removing it (DELETE), next week's forecast reduced by a 3-hour meeting, the journal's meeting line, and the calendar surviving a reload. No console errors.
- **Not tried against the real Google yet:** that needs your OAuth client ID.

## After that: Linked with Atlas (5 Nov 2026)

Atlas, the Mac mind-mapping app, and JourneyMan now share tasks through `~/Documents/JourneyMan/atlas`. Atlas writes `tasks.json` and JourneyMan writes `journeyman.json`. The guide is [`docs/ATLAS.md`](ATLAS.md). The Atlas side is in the Atlas repo (`JOURNEYMAN.md` there).

### What it does

- **Tasks in:** each Atlas map becomes a project. A time block gives the day, time and estimate, the due date gives the deadline, and priority maps to `!`–`!!!`.
- **Edits:** Atlas wins field by field, only when that field changed in Atlas. So renaming a task here, or the journal moving it to tomorrow, sticks until Atlas changes the same thing.
- **Done:** both ways. The later change wins. Tasks now carry `doneChangedAt`, and undo stamps it too.
- **Time:** Atlas focus time becomes deep-work entries (only the growth each time). Time tracked here goes back as its own total, without Atlas's focus time, so neither app counts anything twice.
- **Gone from Atlas:** removed here, or unlinked and kept if it has time on it. A task deleted here stays deleted until it changes in Atlas.
- **Connections ▸ Atlas:** connect the folder in Chrome (read and write), with Sync now and Disconnect. Import tasks.json and Save journeyman.json are there for Safari.
- **Links:** an Atlas row in task details with **Open in Atlas** (`atlas://node/<id>`), and a map icon on the task row. A new `#task/<id>` route opens any task, and Atlas's Open in JourneyMan uses it. The address is swapped for the task's list, so Back doesn't loop.
- **Sync timing:** on open, when the tab comes back, every minute (skipped when the file hasn't changed), and a write 1.5s after any change (skipped when nothing in it changed).

### Fixes found in testing

- An edit in Atlas that wasn't a status change (a rename) undid a tick made here. The import used Atlas's last-edit time when no status time was given. It now goes only by when the status changed.

### Checked

- **Unit tests:** 83 in all. 13 are new in `test/atlas.test.js`, covering:
  - Reading the file.
  - Field mapping.
  - First import and re-import.
  - Field-by-field wins.
  - Done both ways.
  - A rename in Atlas not undoing a tick.
  - Undo stamping.
  - Focus time.
  - Gone, cancelled and archived tasks.
  - Deletion here.
  - Map projects.
  - The export.
- **Browser run (Chromium):** the folder picker was stood in for by the browser's private file system, so the real reading and writing code ran. It covered:
  - Connecting the folder: 2 tasks and a Thesis project were imported.
  - `journeyman.json` being written.
  - `#task/atlas:<id>` in lower case opening the task in its project, with the Atlas row.
  - Ticking it here, which was written within 2 seconds.
  - Atlas renaming the task and adding 25 minutes of focus: the new name and a 25-minute deep-work entry arrived, the tick stayed, and 0 minutes were sent back.
  - The connection surviving a reload.
  - No console errors.
- **Round trip with Atlas's own code:** Atlas's Swift was compiled with Swift 6.0 on Linux and wrote a real `tasks.json`. This app's modules then imported it, ticked a task, logged 30 minutes and wrote `journeyman.json`. Atlas applied that as one undo step (done, and 30 minutes). Reading again on both sides changed nothing.
- **Not tried yet:** Atlas's SwiftUI parts on a Mac, and Chrome asking for a real folder.

## After that: the Mac app (5 Nov 2026)

JourneyMan can now be a real Mac app. `mac/Scripts/make-dmg.sh` builds `JourneyMan-1.0.dmg`, using the same tools and build approach as Atlas (Command Line Tools only, signed on your Mac). Guide: [`mac/README.md`](../mac/README.md).

### What it is

- **A native window around the same pages.** The app serves `index.html`, `css/` and `js/` from inside itself at `journeyman://localhost/`. The web version and the app are one codebase.
- **Folders without asking.** `js/native.js` gives the page folder handles shaped like Chrome's, backed by native code. The activity folder and the Atlas folder are then read and written with the same code as in Chrome. Native code only reaches `~/Documents/JourneyMan`.
- **Calendars from the Mac (EventKit).** Google blocks its sign-in inside apps, so the app reads the calendars the Calendar app shows. Google is included once it's added in Internet Accounts. `js/native.js` presents them as the Google Calendar API, so meetings, free time, Next up, the forecast and time blocks all work unchanged. A time block carries a `journeyman://` link back to its task.
- **Links.** `journeyman://…#task/<id>` opens the app on that task, so Atlas's Open in JourneyMan works. Notion, Atlas and web links open in their own apps. Downloads ask where to save. File pickers and confirm dialogs are native.
- **Menus.** The usual Edit commands, Reload, zoom, full screen, and File ▸ Open JourneyMan Folder. Closing the window keeps the app running.

### Checked

- **Unit tests:** 89 in all. 6 are new in `test/native.test.js`:
  - Folder handles (read, write, missing files, making folders).
  - Time-block links.
  - Mac events read as Google events.
  - `readCalendar` on the Mac's calendars.
  - Making and removing a time block.
- **Browser run of the app mode:** Chromium with a stand-in for the native side. The Atlas folder connected by itself, imported a task and wrote `journeyman.json`. The calendar card had no Google fields, connected, and read a meeting. Block time made an event in the default calendar with the task link, and Remove deleted it. The journal read the activity folder with no button. No console errors.
- **Swift:** `Browser.swift` and `Bridge.swift` compiled with Swift 6.0 on Linux against stand-ins for AppKit, WebKit and EventKit. This catches the code's own mistakes, not differences from Apple's real frameworks. `JourneyManApp.swift` (menus) needs the Objective-C runtime, so it was only read through.
- **Atlas:** Open in JourneyMan now accepts the app's `journeyman://` address. All 152 tests pass.
- **Not tried yet:** building and running on a Mac. That covers the real WebKit (serving pages from `journeyman://` and keeping IndexedDB there), the Calendar and Documents prompts, and the DMG.

