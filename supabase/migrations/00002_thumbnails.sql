-- Allow authenticated users to delete their own uploaded photos.
drop policy if exists "auth delete pet-photos" on storage.objects;
create policy "auth delete pet-photos"
  on storage.objects for delete
  using (bucket_id = 'pet-photos' and auth.role() = 'authenticated');

-- Add a small thumbnail column for map pins and list views (300 px).
-- The full-resolution photo stays in thumbnail_url / photo_url.

alter table public.pets
  add column if not exists thumbnail_small_url text;

-- Expose the new column through the view used by all client queries.
create or replace view public.pets_geo as
select
  id, name, species, description,
  ST_Y(location::geometry) as latitude,
  ST_X(location::geometry) as longitude,
  first_seen_at, last_seen_at, sighting_count,
  thumbnail_url, thumbnail_small_url, created_at
from public.pets;

-- Accept an optional thumb URL and keep it in sync on every sighting log.
create or replace function log_sighting(
  p_pet_id           uuid,
  p_user_id          uuid,
  p_lat              double precision,
  p_lng              double precision,
  p_photo_url        text default null,
  p_note             text default null,
  p_photo_thumb_url  text default null
)
returns public.sightings
language plpgsql as $$
declare
  v_sighting public.sightings;
begin
  insert into public.sightings (pet_id, user_id, location, photo_url, note)
  values (
    p_pet_id,
    p_user_id,
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
