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
