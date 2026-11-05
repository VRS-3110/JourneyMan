# JourneyMan

A second brain and time tracker, Mac first. Capture anything in seconds, sort it into areas and projects (PARA), see what to do next, track where your time goes, and turn each day into a journal. Your knowledge stays in Notion, and JourneyMan links to it and syncs with it.

All five phases of the plan are built. What happened in each phase, and how it was tested, is in [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md).

## Run it

It's a plain web app with no build step. Serve the folder and open it in Safari or Chrome:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

- **Install it like an app.** Safari: File → Add to Dock. Chrome: the install icon in the address bar. It works offline.
- **GitHub Pages.** It runs as-is: Settings → Pages → Deploy from a branch → `main` / (root).

Everything works locally with no accounts. The optional connections (Notion, Claude, device sync) each take about 10 minutes to set up. See [Connections](#connections) below.

## What it does

| | |
| --- | --- |
| **Capture** (`N`) | Quick add reads `#project @area ~30m tomorrow 3pm due fri !!` and Notion links, and shows what it understood before you press Enter. **✨ Brain dump** turns a messy paragraph into separate tasks with Claude. |
| **Organise** | Inbox, Today, Upcoming, Anytime and Logbook. Areas → projects → tasks. A detail pane for every field. `⌘K` to jump anywhere, and `?` for all shortcuts. |
| **Repeat** | `every mon wed fri`, `every 2 weeks`, `every month`, `daily`, `weekdays`, or the Repeat control in a task's details (including "count from when I finish" and an end date). Finishing one creates the next. Upcoming shows the ones still to come, and the forecast counts them. |
| **Track time** (`S`) | A one-tap timer pinned in the sidebar, with deep-work tagging and a "still working?" check after 3 hours. Manual logs (`45m`, `1h30m`). Planned against actual on every task. A daily recap, and a **Time** view with weekly charts and CSV export. |
| **See what matters** | **Next up** on Today ranks tasks by urgency, importance, fit and staleness, and says why. Project health (on track, at risk, stalled, overdue, no next action). The **Insights** view has a 4-week workload forecast, time by area against targets, a focus heatmap, an urgent/important 2×2 and an estimate check. |
| **Journal** | The **Mac helper** records which app and window you're in, kept only on your Mac. The **Journal** view matches that to your work, adds it to Time, compares plan with reality, moves unfinished tasks forward, and writes the day's entry (optionally with Claude). |
| **Weekly review** | A guided six-step review with a streak, a DUE badge, and an optional reflection drafted by Claude. Sent to your Notion journal if you like. |
| **Notion** | Links on any task, project or area that open in the Notion app. CSV import. **Two-way sync** with Notion task databases, with time written back. Journal entries and reviews added to your Notion journal. |
| **Google Calendar** | Meetings come out of your daily hours. Next up prefers tasks that fit before your next meeting, the forecast subtracts meeting time, Today shows your day's events, and the journal lists your meetings. **Block time** puts a task into your first free slot. |
| **Devices** | Sync across your Mac and phone through your own Supabase project. Offline-first, and the newer edit wins. |

### Quick-add syntax

| Type | Means |
| --- | --- |
| `#project` | Put it in a project (a new one is created if needed). Matches by name, so `#thesis` finds "Thesis". |
| `@area` | Put it in an area |
| `~30m`, `~1h30m`, `~1.5h` | Estimate |
| `today`, `tomorrow`, `fri`, `next week`, `in 3 days`, `dec 5` | When you'll do it. A weekday means the next one, never today. With two dates in a line, the last one counts. |
| `3pm`, `15:00` | Time (today if there's no date) |
| `due fri`, `by dec 5` | Deadline |
| `!`, `!!`, `!!!` | Priority |
| a Notion link | Attaches the page |
| `every mon wed fri`, `every 3 days`, `every other week`, `every month`, `daily`, `weekdays` | Repeat |
| `\word` | Keeps a word as text, e.g. `Buy \sun cream` |

## Connections

All of these are optional. Set them up in JourneyMan → Connections.

| Connection | What it needs | Guide |
| --- | --- | --- |
| **Bridge** (for Notion sync and Claude) | A free Cloudflare Worker that holds your Notion token and Anthropic API key | [`worker/README.md`](worker/README.md) |
| **Google Calendar** | Your own free Google OAuth client ID. No server needed. | [`docs/GOOGLE_CALENDAR.md`](docs/GOOGLE_CALENDAR.md) |
| **Mac activity** | A tiny launchd helper (`bash install.sh`) | [`mac-agent/README.md`](mac-agent/README.md) |
| **Device sync** | A free Supabase project | [`supabase/README.md`](supabase/README.md) |

Privacy:

- Your data lives in the browser (IndexedDB) on each device.
- Keys are stored only on the device where you enter them, and are left out of exports and sync.
- Claude features send only what each feature needs, and only when you press a Claude button.
- Mac activity never leaves the Mac unless you add it to Time or a journal.

## Code

```
index.html            page shell and dialogs
css/app.css           Mac-style theme (light and dark), phone layout, charts
js/app.js             interface: views, detail pane, palette, keyboard, timer, connections
js/views/             time, insights, journal, review, connections
js/model.js           data and views (PARA, time entries, journals, tombstones)
js/parse.js           dates and the quick-add parser
js/reports.js         day and week reports, CSV
js/insights.js        Next up ranking, project health, forecasts
js/recurrence.js      repeat rules: parsing, next dates, descriptions
js/calendar.js        meetings, free time and slots (no network)
js/gcal.js            Google sign-in and Calendar API, from the browser
js/activity.js        Mac activity → sessions → matches → time and journal
js/notion.js          Notion mapping and two-way sync (through the bridge)
js/sync.js            Supabase device sync
js/ai.js              calls the Claude features on the bridge
js/charts.js          hand-made SVG charts (colour-blind-checked palette)
js/importers.js       Notion CSV import
js/db.js              IndexedDB storage
sw.js                 offline cache (bump CACHE when files change)
worker/               the bridge: Notion proxy + Claude features (Cloudflare Worker)
mac-agent/            activity helper for macOS
supabase/schema.sql   the sync table, row-level security and push function
test/                 node:test tests
```

Run the tests (Node 20 or later). The bridge's tests need its dependency installed once:

```bash
(cd worker && npm install)
```

```bash
npm test
```
