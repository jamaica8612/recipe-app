alter table public.recipes
  add column if not exists situation_tag_ids text[] not null default '{}';
