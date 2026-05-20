alter table public.members
  add column if not exists source_local_id text;

alter table public.recipes
  add column if not exists source_local_id text;

create unique index if not exists members_user_source_local_id_idx
  on public.members (user_id, source_local_id)
  where source_local_id is not null;

create unique index if not exists recipes_user_source_local_id_idx
  on public.recipes (user_id, source_local_id)
  where source_local_id is not null;
