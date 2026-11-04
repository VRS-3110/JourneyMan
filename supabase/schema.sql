-- JourneyMan device sync: one table of records per user, protected by row-level security.
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.

create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('area', 'project', 'task', 'entry', 'journal', 'prefs')),
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,                     -- when the record last changed on a device
  server_updated_at timestamptz not null default now(), -- when the server last accepted a change (sync cursor)
  primary key (user_id, kind, id)
);

create index if not exists records_user_cursor on public.records (user_id, server_updated_at);

alter table public.records enable row level security;

drop policy if exists "own records: read" on public.records;
create policy "own records: read" on public.records for select using (user_id = auth.uid());
drop policy if exists "own records: insert" on public.records;
create policy "own records: insert" on public.records for insert with check (user_id = auth.uid());
drop policy if exists "own records: update" on public.records;
create policy "own records: update" on public.records for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push a batch of records. A row only replaces the stored one if it is strictly newer, so an older
-- device can never overwrite a newer edit, and echoing a record back changes nothing.
create or replace function public.push_records(rows jsonb)
returns integer
language sql
security invoker
as $$
  with incoming as (
    select r->>'kind' as kind, r->>'id' as id, r->'data' as data,
           coalesce((r->>'deleted')::boolean, false) as deleted, (r->>'updated_at')::timestamptz as updated_at
    from jsonb_array_elements(rows) as r
  ), written as (
    insert into public.records as cur (user_id, kind, id, data, deleted, updated_at)
    select auth.uid(), kind, id, data, deleted, updated_at from incoming
    on conflict (user_id, kind, id) do update
      set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, server_updated_at = now()
      where cur.updated_at < excluded.updated_at
    returning 1
  )
  select count(*)::integer from written;
$$;

grant execute on function public.push_records(jsonb) to authenticated;
