-- Adoption MVP: a pet can be flagged adoptable/adopted by the app owner or a
-- partner shelter via the Supabase dashboard. There is NO in-app write path.
-- Safe to re-run: all statements are idempotent.

alter table public.pets
  add column if not exists status text not null default 'stray'
    check (status in ('stray', 'adoptable', 'adopted'));

-- Email or E.164 phone (+14155551234) for adoption enquiries.
-- Displayed publicly in the app when set.
alter table public.pets
  add column if not exists adoption_contact text;

-- Drop first: CREATE OR REPLACE VIEW can only append columns, and 00002's
-- replace inserted thumbnail_small_url mid-list, so live column order may vary.
drop view if exists public.pets_geo;
create view public.pets_geo as
select
  id, name, species, description,
  ST_Y(location::geometry) as latitude,
  ST_X(location::geometry) as longitude,
  first_seen_at, last_seen_at, sighting_count,
  thumbnail_url, thumbnail_small_url, created_at,
  status, adoption_contact
from public.pets;

-- Return-type change requires drop before create (same pattern as 00001).
-- Also adds thumbnail_small_url, which 00002 forgot to expose via the RPC.
drop function if exists nearby_pets(double precision, double precision, integer);
create or replace function nearby_pets(
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
  adoption_contact    text
)
language sql stable as $$
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
    p.adoption_contact
  from public.pets p
  where ST_DWithin(
    p.location::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_meters
  )
  order by ST_Distance(
    p.location::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  );
$$;
