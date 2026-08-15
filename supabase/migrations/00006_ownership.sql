-- Ownership + write-path hardening.
--
-- Until now every policy on pets/sightings was `auth.role() = 'authenticated'`,
-- and every app user is anonymous-authenticated — so any user could delete any
-- cat (cascading its entire sighting history), rename or relocate any cat, and
-- delete any file in the pet-photos bucket. This ties writes to ownership.
--
-- Safe to re-run: all statements are idempotent.

-- ─── Admin identity ──────────────────────────────────────────────────────────

-- 00005 hardcoded this email inline. Single source of truth now.
-- Deliberately narrower than 00005's inline check: RLS is bypassed outright for
-- the table owner and service_role, so policies need only the email branch. The
-- trigger below still needs the wider check, because triggers are NOT bypassed.
create or replace function public.is_admin()
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'acharjee.prasun@gmail.com';
$$;

create or replace function public.guard_adoption_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.status is distinct from old.status
      or new.adoption_contact is distinct from old.adoption_contact)
     and not (
       public.is_admin()
       -- Supabase dashboard Table/SQL editor and service-role clients
       or auth.jwt() is null
       or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     )
  then
    raise exception 'Only the admin can change adoption fields';
  end if;
  return new;
end;
$$;

-- ─── Pets: who added this cat ────────────────────────────────────────────────

-- Added without the default, then given one, deliberately: ADD COLUMN with a
-- DEFAULT backfills every existing row with it, which would attribute every
-- pre-existing cat to whoever happened to run the migration.
alter table public.pets
  add column if not exists created_by uuid references auth.users(id);
alter table public.pets
  alter column created_by set default auth.uid();

create index if not exists pets_created_by_idx on public.pets(created_by);

-- Rows that predate this migration keep created_by = null, so only the admin can
-- remove them. That is the intended safe default — no backfill.

drop policy if exists "pets_insert" on public.pets;
create policy "pets_insert" on public.pets for insert
  with check (auth.role() = 'authenticated' and created_by = auth.uid());

-- Sighting logging still needs to touch every pet row (last_seen_at, location,
-- thumbnails) — that path now goes through log_sighting(), which is SECURITY
-- DEFINER and so bypasses this policy. Direct client updates are creator-only.
drop policy if exists "pets_update" on public.pets;
create policy "pets_update" on public.pets for update
  using (created_by = auth.uid() or public.is_admin());

drop policy if exists "pets_delete" on public.pets;
create policy "pets_delete" on public.pets for delete
  using (created_by = auth.uid() or public.is_admin());

-- ─── Sightings: who logged it ────────────────────────────────────────────────

alter table public.sightings
  alter column user_id set default auth.uid();

drop policy if exists "sightings_insert" on public.sightings;
create policy "sightings_insert" on public.sightings for insert
  with check (auth.role() = 'authenticated' and user_id = auth.uid());

drop policy if exists "sightings_update" on public.sightings;
create policy "sightings_update" on public.sightings for update
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "sightings_delete" on public.sightings;
create policy "sightings_delete" on public.sightings for delete
  using (user_id = auth.uid() or public.is_admin());

-- ─── Storage: delete only your own uploads ───────────────────────────────────

-- `owner` is set by Supabase Storage from the uploader's JWT. 00003 let any
-- authenticated user delete any file in the bucket.
drop policy if exists "auth delete pet-photos" on storage.objects;
create policy "auth delete pet-photos"
  on storage.objects for delete
  using (bucket_id = 'pet-photos' and owner = auth.uid());

-- ─── log_sighting: SECURITY DEFINER, identity from the session ───────────────

-- Drops both earlier signatures (00001's 6-arg, 00003's 7-arg) — p_user_id is
-- gone. A definer function that trusts a caller-supplied user id would let anyone
-- forge sightings under another identity, which now matters because ownership
-- drives delete rights.
drop function if exists public.log_sighting(uuid, uuid, double precision, double precision, text, text);
drop function if exists public.log_sighting(uuid, uuid, double precision, double precision, text, text, text);

create or replace function public.log_sighting(
  p_pet_id           uuid,
  p_lat              double precision,
  p_lng              double precision,
  p_photo_url        text default null,
  p_note             text default null,
  p_photo_thumb_url  text default null
)
returns public.sightings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sighting public.sightings;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required to log a sighting';
  end if;

  insert into public.sightings (pet_id, user_id, location, photo_url, note)
  values (
    p_pet_id,
    auth.uid(),
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_photo_url,
    p_note
  )
  returning * into v_sighting;

  update public.pets
  set
    sighting_count      = sighting_count + 1,
    last_seen_at        = now(),
    location            = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    thumbnail_url       = coalesce(p_photo_url, thumbnail_url),
    thumbnail_small_url = coalesce(p_photo_thumb_url, thumbnail_small_url)
  where id = p_pet_id;

  return v_sighting;
end;
$$;

revoke execute on function
  public.log_sighting(uuid, double precision, double precision, text, text, text)
  from public, anon;
grant execute on function
  public.log_sighting(uuid, double precision, double precision, text, text, text)
  to authenticated;

-- ─── clear_sighting_photo: replaces a 3-round-trip client flow ───────────────

-- The app used to null photo_url and then repair pets.thumbnail_* from the
-- client — but repairing the pet row is exactly what pets_update now forbids for
-- non-creators. Doing it in one definer function also closes the race between
-- the two writes.
create or replace function public.clear_sighting_photo(p_sighting_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sighting   public.sightings;
  v_next_photo text;
begin
  select * into v_sighting from public.sightings where id = p_sighting_id;
  if not found then
    raise exception 'Sighting not found';
  end if;

  if not (v_sighting.user_id = auth.uid() or public.is_admin()) then
    raise exception 'You can only remove photos you added';
  end if;

  update public.sightings set photo_url = null where id = p_sighting_id;

  -- Most recent remaining photo for this cat, if any.
  select photo_url into v_next_photo
  from public.sightings
  where pet_id = v_sighting.pet_id
    and id <> p_sighting_id
    and photo_url is not null
  order by created_at desc
  limit 1;

  -- Only repair the pet if it was actually showing the photo being removed.
  -- The _thumb.jpg suffix is the upload convention from src/lib/storage.ts
  -- (uploadPhoto writes <id>.jpg and <id>_thumb.jpg side by side).
  update public.pets
  set thumbnail_url       = v_next_photo,
      thumbnail_small_url = case
                              when v_next_photo is null then null
                              else regexp_replace(v_next_photo, '\.jpg$', '_thumb.jpg')
                            end
  where id = v_sighting.pet_id
    and thumbnail_url is not distinct from v_sighting.photo_url;
end;
$$;

revoke execute on function public.clear_sighting_photo(uuid) from public, anon;
grant execute on function public.clear_sighting_photo(uuid) to authenticated;

-- ─── Views / RPCs expose created_by ──────────────────────────────────────────

drop view if exists public.pets_geo;
create view public.pets_geo as
select
  id, name, species, description,
  ST_Y(location::geometry) as latitude,
  ST_X(location::geometry) as longitude,
  first_seen_at, last_seen_at, sighting_count,
  thumbnail_url, thumbnail_small_url, created_at,
  status, adoption_contact, created_by
from public.pets;

-- Return-type change requires drop before create (same pattern as 00001/00004).
drop function if exists public.nearby_pets(double precision, double precision, integer);
create or replace function public.nearby_pets(
  lat           double precision,
  lng           double precision,
  radius_meters integer default 500
)
returns table(
  id                  uuid,
  name                text,
  species             text,
  description         text,
  latitude            double precision,
  longitude           double precision,
  first_seen_at       timestamptz,
  last_seen_at        timestamptz,
  sighting_count      integer,
  thumbnail_url       text,
  thumbnail_small_url text,
  created_at          timestamptz,
  status              text,
  adoption_contact    text,
  created_by          uuid,
  distance_meters     double precision
)
language sql stable
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.name,
    p.species,
    p.description,
    ST_Y(p.location::geometry) as latitude,
    ST_X(p.location::geometry) as longitude,
    p.first_seen_at,
    p.last_seen_at,
    p.sighting_count,
    p.thumbnail_url,
    p.thumbnail_small_url,
    p.created_at,
    p.status,
    p.adoption_contact,
    p.created_by,
    ST_Distance(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) as distance_meters
  from public.pets p
  where ST_DWithin(
    p.location::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_meters
  )
  -- Repeated rather than `order by distance_meters`: that name is also an OUT
  -- parameter here, and the reference would be ambiguous.
  order by ST_Distance(
    p.location::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  );
$$;
