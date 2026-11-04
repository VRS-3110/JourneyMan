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
