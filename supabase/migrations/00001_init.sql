-- Safe to re-run: all statements are idempotent.

-- ─── Extensions ──────────────────────────────────────────────────────────────

create extension if not exists postgis;
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- ─── Storage ─────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "public read pet-photos" on storage.objects;
create policy "public read pet-photos"
  on storage.objects for select
  using (bucket_id = 'pet-photos');

drop policy if exists "auth upload pet-photos" on storage.objects;
create policy "auth upload pet-photos"
  on storage.objects for insert
  with check (bucket_id = 'pet-photos' and auth.role() = 'authenticated');

-- ─── Pets ────────────────────────────────────────────────────────────────────

create table if not exists public.pets (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  species       text not null default 'cat',
  description   text,
  location      geography(Point, 4326) not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  sighting_count integer not null default 1,
  thumbnail_url text,
  embedding     vector(512),
  created_at    timestamptz not null default now()
);

create index if not exists pets_location_gist on public.pets using gist(location);
create index if not exists pets_embedding_ivf on public.pets using ivfflat(embedding vector_cosine_ops)
  with (lists = 100);

alter table public.pets enable row level security;

drop policy if exists "pets_read"   on public.pets;
drop policy if exists "pets_insert" on public.pets;
drop policy if exists "pets_update" on public.pets;
drop policy if exists "pets_delete" on public.pets;
create policy "pets_read"   on public.pets for select using (true);
create policy "pets_insert" on public.pets for insert with check (auth.role() = 'authenticated');
create policy "pets_update" on public.pets for update using (auth.role() = 'authenticated');
create policy "pets_delete" on public.pets for delete using (auth.role() = 'authenticated');

-- ─── Sightings ───────────────────────────────────────────────────────────────

create table if not exists public.sightings (
  id         uuid primary key default uuid_generate_v4(),
  pet_id     uuid not null references public.pets(id) on delete cascade,
  user_id    uuid references auth.users(id),
  location   geography(Point, 4326) not null,
  photo_url  text,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists sightings_pet_id_idx     on public.sightings(pet_id);
create index if not exists sightings_created_at_idx on public.sightings(created_at desc);

alter table public.sightings enable row level security;

drop policy if exists "sightings_read"   on public.sightings;
drop policy if exists "sightings_insert" on public.sightings;
drop policy if exists "sightings_delete" on public.sightings;
create policy "sightings_read"   on public.sightings for select using (true);
create policy "sightings_insert" on public.sightings for insert
  with check (auth.role() = 'authenticated');
create policy "sightings_delete" on public.sightings for delete
  using (auth.role() = 'authenticated');

-- ─── Functions ───────────────────────────────────────────────────────────────

drop function if exists nearby_pets(double precision, double precision, integer);
create or replace function nearby_pets(
  lat           double precision,
  lng           double precision,
  radius_meters integer default 500
)
returns table(
  id             uuid,
  name           text,
  species        text,
  description    text,
  latitude       double precision,
  longitude      double precision,
  first_seen_at  timestamptz,
  last_seen_at   timestamptz,
  sighting_count integer,
  thumbnail_url  text,
  created_at     timestamptz
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
    p.created_at
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

create or replace function match_pets(
  query_embedding vector(512),
  lat             double precision,
  lng             double precision,
  radius_meters   integer default 200,
  match_threshold double precision default 0.65,
  match_count     integer default 5
)
returns table(
  id              uuid,
  name            text,
  thumbnail_url   text,
  similarity      double precision,
  distance_meters double precision
)
language sql stable as $$
  select
    p.id,
    p.name,
    p.thumbnail_url,
    1 - (p.embedding <=> query_embedding)                                    as similarity,
    ST_Distance(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    )                                                                        as distance_meters
  from public.pets p
  where
    p.embedding is not null
    and ST_DWithin(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      radius_meters
    )
    and 1 - (p.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

create or replace function log_sighting(
  p_pet_id    uuid,
  p_user_id   uuid,
  p_lat       double precision,
  p_lng       double precision,
  p_photo_url text default null,
  p_note      text default null
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
    sighting_count = sighting_count + 1,
    last_seen_at   = now(),
    location       = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    thumbnail_url  = coalesce(p_photo_url, thumbnail_url)
  where id = p_pet_id;

  return v_sighting;
end;
$$;

-- ─── Views ───────────────────────────────────────────────────────────────────

create or replace view public.pets_geo as
select
  id, name, species, description,
  ST_Y(location::geometry) as latitude,
  ST_X(location::geometry) as longitude,
  first_seen_at, last_seen_at, sighting_count, thumbnail_url, created_at
from public.pets;

create or replace view public.sightings_geo as
select
  id, pet_id, user_id, photo_url, note, created_at,
  ST_Y(location::geometry) as latitude,
  ST_X(location::geometry) as longitude
from public.sightings;
