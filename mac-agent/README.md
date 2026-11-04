# JourneyMan Mac activity helper

Shows JourneyMan what you actually did on your Mac, so the **Journal** view can turn your day into time entries and a journal entry.

## What it records

Every 30 seconds it records one line: the time, the app in front, that window's title, and how long since you last touched the keyboard or mouse. That's all.

- Nothing leaves your Mac. Files go to `~/Documents/JourneyMan/activity/`, one per day, and are kept for 60 days.
- Nothing is recorded while the screen is locked.
- Apps in `EXCLUDE` are recorded as "Private", with no title. The defaults are password managers, Messages and FaceTime.
- Set `TITLES=0` to record app names only.
- Set `PAUSED=1` to stop recording without uninstalling.

Settings are in `~/Documents/JourneyMan/activity/config` and take effect within 30 seconds.

## Install

```bash
bash install.sh
```

macOS asks for two permissions the first time:

1. **"osascript" wants to control "System Events"**: choose Allow. This reads the name of the app in front.
2. **Accessibility**, for window titles: open System Settings → Privacy & Security → Accessibility and add `/usr/bin/osascript`. If you skip this, only app names are recorded.

## Use it in JourneyMan

Open **Journal**.

- **In Chrome:** choose **Connect activity folder** and pick `Documents/JourneyMan/activity`. JourneyMan reads today's file whenever you open the Journal.
- **In Safari:** choose **Import a day's file** and pick the `.jsonl` file for that day.

JourneyMan then:

- matches each stretch of time to a task, project or area. It looks for their names in window titles and follows rules you create with **Assign**.
- shows planned against actual: what got done, what you worked on, and what you didn't start. Unfinished tasks can move to tomorrow in one click.
- turns matched time into time entries. It skips time a timer already covered, and running it again replaces rather than double counts.
- writes a journal entry for the day, which it can also add to your Notion journal.

## Remove

```bash
bash uninstall.sh
```

Your activity files stay until you delete them.
