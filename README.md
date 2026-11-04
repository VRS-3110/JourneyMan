# JourneyMan

A second brain and time tracker for the Mac. Capture anything in a couple of seconds, sort it into areas and projects (PARA), and see what to do today. Your knowledge stays in Notion, and JourneyMan links to it.

This is **phase 1: Capture and organise**. See the roadmap below.

## Run it

It's a plain web app with no build step. Serve the folder and open it in Safari or Chrome:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To use it like an app: in Safari choose **File → Add to Dock**; in Chrome click the install icon in the address bar. It works offline.

On GitHub Pages it runs as-is: **Settings → Pages → Deploy from a branch → main / (root)**.

## What's in phase 1

- **Quick add** (`N`): type a whole task in one line and see what will be saved before you press Enter.
- **Inbox, Today, Upcoming, Anytime, Logbook**: Today shows overdue and due tasks, and compares your estimates with the hours you have.
- **Areas → Projects → Tasks**: project cards show progress, estimated time left and the deadline.
- **Detail pane**: project, area, when, time, deadline, estimate, priority, notes and Notion link.
- **Keyboard first**: `J`/`K` to move, `X` to complete, `T` for today, `M` to move, `⌘K` to jump anywhere, `⌘Z` to undo. Press `?` for the full list.
- **Notion**:
  - Paste a Notion link into quick add, or into the Notion field of any task, project or area. **Open** takes you to the page in the Notion Mac app.
  - **Import a Notion database:** in Notion, choose ••• → Export → Markdown & CSV, then pick the CSV under **Projects → Import a Notion database**. The Name or Task, Status, Due, Est. hours and Notes columns are mapped.
- **Your data stays on your Mac** in the browser's IndexedDB. **Settings → Export backup** saves a JSON file you can import again.

### Quick-add syntax

| Type | Means |
| --- | --- |
| `#project` | Put it in a project (a new one is created if needed). Matches by name, so `#thesis` finds "Thesis". |
| `@area` | Put it in an area |
| `~30m`, `~1h30m`, `~1.5h` | Estimate |
| `today`, `tomorrow`, `fri`, `next week`, `in 3 days`, `dec 5` | When you'll do it. A weekday means the next one, never today. |
| `3pm`, `15:00` | Time (today if there's no date) |
| `due fri`, `by dec 5` | Deadline |
| `!`, `!!`, `!!!` | Priority |
| a notion.so link | Attaches the Notion page |
| `\word` | Keeps a word as text, e.g. `Buy \sun cream` |

Anything with no project, area or date goes to the Inbox.

## Roadmap

1. **Capture and organise** (this version)
2. **Time tracking:** one-tap timer, planned against actual time, daily and weekly reports
3. **Visualise:** Next up ranking, project health, workload forecast, time by area
4. **Notion bridge:** two-way sync with chosen Notion databases through the Notion API, time written back to Notion, daily recap into your journal
5. **Sync and AI:** use it on more devices, AI capture and planning with Claude

The full proposal lives in a separate doc.

## Code

```
index.html          page shell and dialogs
css/app.css         Mac-style theme, light and dark
js/app.js           interface: views, detail pane, palette, keyboard
js/model.js         data and views (inbox, today, upcoming, project stats)
js/parse.js         dates and the quick-add parser
js/importers.js     Notion CSV import
js/db.js            IndexedDB storage
sw.js               offline cache (bump CACHE when files change)
test/               node:test tests for parse, model and importers
```

Run the tests (Node 20 or later):

```bash
npm test
```
