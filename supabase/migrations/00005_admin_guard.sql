-- Guard adoption fields: only the admin may change status / adoption_contact.
-- The mobile app's anonymous users still update pets freely (sighting logging,
-- thumbnail sync), so we guard just these two columns instead of tightening RLS.
-- Safe to re-run: all statements are idempotent.

create or replace function public.guard_adoption_columns()
returns trigger
language plpgsql
as $$
begin
  if (new.status is distinct from old.status
      or new.adoption_contact is distinct from old.adoption_contact)
     and not (
       -- admin logged in via the web dashboard
       coalesce(auth.jwt()->>'email', '') = 'acharjee.prasun@gmail.com'
       -- Supabase dashboard Table/SQL editor and service-role clients
       or auth.jwt() is null
       or coalesce(auth.jwt()->>'role', '') = 'service_role'
     )
  then
    raise exception 'Only the admin can change adoption fields';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_adoption_columns on public.pets;
create trigger guard_adoption_columns
  before update on public.pets
  for each row execute function public.guard_adoption_columns();
