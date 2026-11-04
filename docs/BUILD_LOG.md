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
