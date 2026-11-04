# Sync across devices with Supabase

JourneyMan keeps working offline on each device and syncs through your own Supabase project. Supabase is a hosted Postgres database with sign-in, and its free plan is plenty.

## Set up (about 10 minutes, once)

1. **Create a project** at https://supabase.com (New project). Pick a region near you.

2. **Create the table.** Open SQL Editor → New query, paste all of `schema.sql`, and choose Run. This creates:
   - one `records` table;
   - row-level security, so each signed-in user only ever sees their own rows;
   - a `push_records` function that keeps a record only when it is strictly newer. An old device can't overwrite newer edits.

3. **Allow your app's address.** Go to Authentication → URL Configuration and set:
   - **Site URL:** where JourneyMan runs, e.g. `https://vrs-3110.github.io/JourneyMan/`
   - **Redirect URLs:** add the same address, plus `http://localhost:8000` for local use.

4. **Show the 6-digit code in the sign-in email.** This lets you sign in inside the installed app, where tapping a link would open your browser instead. Go to Authentication → Emails → Magic Link and add this line to the template:

   ```
   Or enter this code in JourneyMan: {{ .Token }}
   ```

5. **Copy two values** from Project Settings → API: the **Project URL** and the **anon public** key. The anon key is safe in the app. Row-level security is what protects your data.

## Connect each device

In JourneyMan → Connections → Sync across devices:

1. Paste the Project URL and the anon key.
2. Enter your email and choose **Email me a code**.
3. Type the 6-digit code and choose **Sign in**. Tapping the link in the email works too, if it opens on that same device.

On a device that already has tasks, JourneyMan asks whether to add them to your synced data or replace them with it.

## What syncs

- Synced: areas, projects, tasks, time entries, journal entries, and shared settings (daily hours, work days, estimate adjustment, weekly reviews, activity rules).
- Not synced: Notion and bridge keys, the Supabase session, and Mac activity sessions. These stay on each device.

## How it syncs

- **When:** every 2 minutes, 20 seconds after a change, when the app comes back into view, and when you come back online.
- **Conflicts:** each record carries the time it last changed, and the newer edit wins. Deletions sync too.
