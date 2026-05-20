alter table public.members
  add constraint members_user_source_local_id_key unique (user_id, source_local_id);

alter table public.recipes
  add constraint recipes_user_source_local_id_key unique (user_id, source_local_id);
