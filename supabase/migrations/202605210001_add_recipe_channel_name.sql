alter table public.recipes
  add column if not exists channel_name text;
