# Atlas

[Atlas](https://github.com/VRS-3110/Atlas) is the Mac mind-mapping app. Linked with JourneyMan:

- Atlas tasks show up here, with a project for each map.
- Ticking a task in either app ticks it in both.
- Focus time from Atlas lands in Time as deep work.
- Time tracked here shows in Atlas's inspector.
- **Open in Atlas** (task details, and the map icon on a task) and Atlas's
  **Open in JourneyMan** jump between them.

Nothing goes online. The two apps share one folder on your Mac:
`~/Documents/JourneyMan/atlas`, next to the Mac helper's `activity` folder.

## Set it up (about 2 minutes)

1. **Atlas** ▸ Settings ▸ JourneyMan: turn on **Share tasks with JourneyMan**. Atlas creates
   the folder and writes `tasks.json`. If macOS asks whether Atlas can use your Documents
   folder, allow it.
2. **JourneyMan in Chrome** ▸ Connections ▸ Atlas: choose **Connect the Atlas folder**. Pick
   `Documents/JourneyMan/atlas` (picking `Documents/JourneyMan` works too), and allow
   JourneyMan to view and edit it.
3. The first time you choose **Open in Atlas**, Chrome asks whether to open Atlas. Tick
   "Always allow".

After Chrome restarts, it may ask again for the folder. Choose **Reconnect** in Connections.

**Safari:** Safari can't keep a folder connected. In Connections ▸ Atlas, use
**Import tasks.json…** to read Atlas's file. Then use **Save journeyman.json** and put the
file into the same folder for Atlas to read.

## When things sync

- **JourneyMan** reads `tasks.json` when it opens, when its tab comes back into view,
  and every minute (only if Atlas has rewritten it). It writes `journeyman.json` a moment
  after anything changes. **Sync now** does both at once.
- **Atlas** writes `tasks.json` 1.5 seconds after a task changes. It reads `journeyman.json`
  at launch, when it comes to the front, and every 30 seconds.

## Who wins

| What | Direction | Rule |
| --- | --- | --- |
| Name, day and time, estimate, deadline, priority | Atlas → JourneyMan | A change in Atlas replaces that field here. Edits you make here stay until that field changes in Atlas. |
| Map | Atlas → JourneyMan | Each map becomes a project. Renaming the map renames the project, unless you renamed the project here. Moving a task to another map moves it to that project. |
| Done | Both ways | The app where it was changed last wins. "Doing" in Atlas counts as not done. |
| Focus time in Atlas | Atlas → JourneyMan | Atlas keeps a total. The growth since the last read becomes one deep-work entry, at the time Atlas last changed the task. |
| Time tracked here | JourneyMan → Atlas | Sent as its own total. Focus time that came from Atlas is left out, so nothing is counted twice. |
| Deleted, cancelled or archived in Atlas | Atlas → JourneyMan | Removed here. If it has time logged, it is kept and unlinked instead. It comes back if it reappears in Atlas. |
| Deleted here | — | Only removed here. It comes back if it changes in Atlas. |

How Atlas fields map to JourneyMan:

- A task's time block in Atlas gives its day, time and estimate here.
- Atlas's default 30 minutes on an unscheduled task is not used as an estimate.
- Atlas's due date becomes the deadline.
- Priority: low is `!`, medium is `!!`, and high is `!!!`.
- Tasks on no map go to the Inbox, unless they have a date.

## The files

Both are JSON. Dates are ISO 8601 in UTC. Each file has a `format` number, and a reader
refuses a format newer than it knows.

### `tasks.json` (written by Atlas)

```json
{
  "app": "Atlas", "format": 1, "exportedAt": "2026-11-05T09:00:00.000Z",
  "tasks": [{
    "id": "6F1C2B9E-0A57-4D7B-9E1A-1B2C3D4E5F60",
    "title": "Draft literature review",
    "status": "todo",
    "statusChangedAt": "2026-11-05T08:59:00.000Z",
    "priority": "high",
    "due": "2026-11-09T00:00:00.000Z",
    "scheduledStart": "2026-11-06T09:00:00.000Z",
    "durationMinutes": 90,
    "focusMinutes": 25,
    "map": { "id": "403E683A-8F97-4205-942E-1D97EAEBA87D", "name": "Thesis" },
    "tags": [], "inbox": "none",
    "createdAt": "…", "updatedAt": "…",
    "url": "atlas://node/6F1C2B9E-0A57-4D7B-9E1A-1B2C3D4E5F60"
  }]
}
```

- `status`: `todo`, `doing`, `done` or `cancelled`.
- `priority`: `none`, `low`, `medium` or `high`.
- `map`: the first map the task is on. It is left out for tasks that live only in Atlas's
  planner.
- `inbox`: `none`, or `inbox` for a capture not yet filed.
- Fields with no value are left out.

### `journeyman.json` (written by JourneyMan)

```json
{
  "app": "JourneyMan", "format": 1, "exportedAt": "2026-11-05T09:30:00.000Z",
  "appUrl": "http://localhost:8000/",
  "tasks": [{
    "atlasId": "6F1C2B9E-0A57-4D7B-9E1A-1B2C3D4E5F60",
    "done": true,
    "doneChangedAt": "2026-11-05T09:30:00.000Z",
    "trackedMinutes": 30
  }]
}
```

- `appUrl`: this page's address. Atlas builds **Open in JourneyMan** from it.
- `trackedMinutes`: time tracked in JourneyMan itself.

## Links

- `#task/<id>` opens any task in its list, with its details. For an Atlas task the id is
  `atlas:<Atlas id>`. If the task hasn't arrived yet, JourneyMan reads the Atlas folder
  first.
- `atlas://node/<id>` opens Atlas at that node.

## Code

| File | What it does |
| --- | --- |
| `js/atlas.js` | Reading `tasks.json`, the merge rules, and writing `journeyman.json`. No DOM and no files. |
| `js/app.js` | The folder (File System Access API), syncing, the `#task/` route, and the detail row. |
| `js/views/connections.js` | The Atlas card. |
| `test/atlas.test.js` | The rules above. |

Imported tasks have the id `atlas:<node id>`. They also have these fields:

- `atlasId`: the node they're linked to.
- `atlasMapId`: the node's map.
- `atlasSeen`: the Atlas values last read, so edits made here can be told apart.
- `atlasFocus`: the focus minutes already logged.

Tasks also have `doneChangedAt`, stamped whenever done changes, including by undo.
