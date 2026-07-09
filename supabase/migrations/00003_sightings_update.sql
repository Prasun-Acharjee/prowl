-- sightings had no UPDATE policy, so clearing photo_url was silently blocked by RLS.
drop policy if exists "sightings_update" on public.sightings;
create policy "sightings_update" on public.sightings for update
  using (auth.role() = 'authenticated');
