# Connect Google Calendar

JourneyMan reads your calendar straight from the browser, with no server and no bridge. Google needs to know which website is asking, so you create a free OAuth client ID once. It takes about 5 minutes.

## 1. Create the client ID

1. Go to https://console.cloud.google.com, then create a project (for example "JourneyMan").
2. Go to **APIs & Services → Library**, search for **Google Calendar API**, and choose **Enable**.
3. Go to **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding**):
   - User type: **External**. App name: JourneyMan. Add your email as the support and developer contact.
   - Under **Audience → Test users**, add your own Google account. While the app is in testing, only test users can sign in, which is right for a personal app.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: where JourneyMan runs, for example `https://vrs-3110.github.io` and `http://localhost:8000`.
   - No redirect URI is needed.
5. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

## 2. Connect in JourneyMan

1. Open Connections → Google Calendar, paste the client ID, and set your work hours.
2. Choose **Connect Google Calendar**.
   - Google warns that the app isn't verified. That's expected for your own test app, so choose Continue.
   - Allow it to see your calendar list and to view and edit events. Editing is only used for the time blocks you ask for.
3. Tick which calendars count as busy, and pick where time blocks go.

## What it does

- **Today:** a "Calendar today" card, and the hours bar subtracts your meetings from your daily hours.
- **Next up:** prefers tasks that fit before your next meeting ("Fits before Supervisor at 14:00").
- **Insights:** the 4-week workload forecast subtracts meeting time from each week.
- **Upcoming:** each day shows how many hours of meetings it has.
- **Journal:** the day's entry lists your meetings.
- **Task details:** **Block 45m in Calendar** puts the task into your first free slot and sets its time. **Remove** deletes that event again.

Events that don't count as busy: all-day events, events shown as "free", cancelled events and invitations you declined.

## Privacy and sign-in

- Events for the next 4 weeks are kept only on this device. They're not exported, and not synced to your other devices. Each device connects on its own.
- Google sign-ins last about an hour. Within that hour, JourneyMan refreshes your events every 15 minutes. After it runs out, it keeps using the last events it read, and **Refresh** (on Today or in Connections) signs in again with one click.
- **Disconnect** removes JourneyMan's access token and the saved events. Time blocks already made stay in your calendar.
