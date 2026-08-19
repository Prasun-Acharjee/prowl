-- Constrain `species` to the set the app actually understands.
--
-- 00001 created the column as a bare `text not null default 'cat'`, from a time
-- when nothing but cats could be added. The app now offers a cat/dog choice at
-- creation, which makes the column a real input rather than a constant, and an
-- unconstrained text field that the UI branches on is a bug waiting to happen:
-- one typo in a client and the map renders a pet nothing can filter or label.
--
-- `status` in 00004 is checked the same way, for the same reason.
--
-- Safe to re-run: all statements are idempotent.

-- Normalise before constraining. Rows predating this migration are all 'cat' by
-- default, but a hand-edit in the SQL editor or an older client could have left
-- anything in there, and adding the constraint would then fail on the whole
-- table. Unknown values land on 'cat', which is what they displayed as anyway.
-- (The column is NOT NULL from 00001, so there are no nulls to consider.)
update public.pets
   set species = 'cat'
 where species not in ('cat', 'dog');

-- `add constraint if not exists` does not exist for check constraints, so drop
-- first. Named explicitly rather than letting Postgres generate one, so the drop
-- can find it on a re-run.
alter table public.pets
  drop constraint if exists pets_species_check;

alter table public.pets
  add constraint pets_species_check check (species in ('cat', 'dog'));
