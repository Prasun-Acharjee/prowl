-- Content reporting and user blocking.
--
-- Required by Google Play's User Generated Content policy: any user can put a
-- photo on a public map, so there must be an in-app way to report objectionable
-- content and to block the account that posted it.
--
-- Reporting hides the item from the reporter only — never globally. A global
-- hide-on-report would let anyone wipe any cat off the map by reporting it,
-- which is the same griefing hole the ownership policies in 00006 closed.
-- The admin decides what actually comes down, from the dashboard.
--
-- Blocking is only possible because 00006 added pets.created_by; before that
-- there was no way to attribute content to an account.
--
-- Safe to re-run: all statements are idempotent.

-- ─── Reports ─────────────────────────────────────────────────────────────────

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null default auth.uid() references auth.users(id),
  -- Polymorphic on purpose: no FK, so a report survives the content it names.
  -- Deleting the offending pet must not erase the record that it was reported.
  target_type  text not null check (target_type in ('pet', 'sighting')),
  target_id    uuid not null,
  reason       text not null check (reason in ('inappropriate', 'not_a_cat', 'spam', 'other')),
  note         text,
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at   timestamptz not null default now(),
  -- One report per person per item; re-reporting is a no-op, not a pile-on.
  unique (reporter_id, target_type, target_id)
);

create index if not exists reports_open_idx on public.reports(created_at desc) where status = 'open';
create index if not exists reports_target_idx on public.reports(target_type, target_id);

alter table public.reports enable row level security;

drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports for insert
  with check (auth.role() = 'authenticated' and reporter_id = auth.uid());

-- Reporters see their own; the admin sees the queue.
drop policy if exists "reports_read" on public.reports;
create policy "reports_read" on public.reports for select
  using (reporter_id = auth.uid() or public.is_admin());

-- Only the admin resolves. Reporters cannot retract, which keeps the audit trail.
drop policy if exists "reports_update" on public.reports;
create policy "reports_update" on public.reports for update
  using (public.is_admin());

-- ─── Blocks ──────────────────────────────────────────────────────────────────

create table if not exists public.user_blocks (
  blocker_id uuid not null default auth.uid() references auth.users(id),
  blocked_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- Entirely private: you manage your own block list and nobody else can read it.
-- Deliberately not visible to the admin — a block list is not moderation data.
drop policy if exists "user_blocks_all" on public.user_blocks;
create policy "user_blocks_all" on public.user_blocks for all
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- ─── What the caller should not see ──────────────────────────────────────────

-- SECURITY INVOKER on purpose: the reports and user_blocks reads below are
-- filtered by RLS to the calling user, which is exactly the scoping we want.
-- Returns a single row of two arrays so the client makes one round trip.
--
-- Anything you reported stays hidden from you regardless of how the admin
-- resolves it — having objected once, you should not have it resurface.
create or replace function public.my_hidden_content()
returns table (hidden_pet_ids uuid[], hidden_sighting_ids uuid[])
language sql stable
set search_path = public, pg_temp
as $$
  select
    coalesce(array(
      select p.id from public.pets p
        where p.created_by in (select b.blocked_id from public.user_blocks b)
      union
      select r.target_id from public.reports r where r.target_type = 'pet'
    ), '{}'::uuid[]),
    coalesce(array(
      select s.id from public.sightings s
        where s.user_id in (select b.blocked_id from public.user_blocks b)
      union
      select r.target_id from public.reports r where r.target_type = 'sighting'
    ), '{}'::uuid[]);
$$;

revoke execute on function public.my_hidden_content() from public, anon;
grant execute on function public.my_hidden_content() to authenticated;

-- ─── Who posted a sighting photo ─────────────────────────────────────────────

-- The photo viewer needs the uploader to offer "block this contributor", and
-- sightings.user_id is already returned by the sightings query, so nothing more
-- is needed there. Pets expose created_by via pets_geo as of 00006.
