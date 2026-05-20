create extension if not exists "pgcrypto";

create type public.plan_type as enum ('free', 'pro', 'family');
create type public.analysis_status as enum ('ready', 'needs_review', 'failed');
create type public.analysis_failure_reason as enum (
  'not_recipe',
  'unavailable',
  'schema_invalid',
  'insufficient_content',
  'too_long',
  'api_unavailable'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan public.plan_type not null default 'free',
  monthly_analyses_used integer not null default 0 check (monthly_analyses_used >= 0),
  monthly_reset_at timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint categories_default_owner_check check (
    (is_default and user_id is null) or (not is_default and user_id is not null)
  )
);

create unique index categories_default_name_idx on public.categories (lower(name)) where is_default;
create unique index categories_user_name_idx on public.categories (user_id, lower(name)) where not is_default;

insert into public.categories (name, icon, is_default)
values
  ('한식', '🍚', true),
  ('양식', '🍝', true),
  ('일식', '🍣', true),
  ('중식', '🥟', true),
  ('디저트', '🍰', true),
  ('기타', '📦', true)
on conflict do nothing;

create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text not null default '👤',
  color text not null default 'terra',
  allergies text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index members_user_id_idx on public.members (user_id);

create table public.video_analyses (
  youtube_video_id text primary key,
  title text not null,
  raw_recipe jsonb not null,
  suggested_category text not null default '기타',
  confidence numeric(3, 2) not null default 0 check (confidence >= 0 and confidence <= 1),
  status public.analysis_status not null default 'ready',
  needs_review boolean not null default false,
  failure_reason public.analysis_failure_reason,
  accepted_count integer not null default 0 check (accepted_count >= 0),
  reported_count integer not null default 0 check (reported_count >= 0),
  thumbnail_url_yt text,
  analyzed_at timestamptz not null default now(),
  last_validated_at timestamptz,
  model_version text not null default 'mock-v1'
);

create index video_analyses_status_idx on public.video_analyses (status, needs_review);

create table public.analysis_failures (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  reason public.analysis_failure_reason not null,
  message text,
  occurred_at timestamptz not null default now()
);

create index analysis_failures_video_id_idx on public.analysis_failures (youtube_video_id);
create index analysis_failures_user_id_idx on public.analysis_failures (user_id);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id text references public.video_analyses(youtube_video_id) on delete set null,
  title text not null,
  category_id uuid references public.categories(id) on delete set null,
  servings integer not null default 1 check (servings > 0),
  cook_time_min integer not null default 0 check (cook_time_min >= 0),
  custom_notes text,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_user_id_idx on public.recipes (user_id);
create index recipes_video_id_idx on public.recipes (video_id);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null,
  amount text,
  unit text,
  sort_order integer not null default 0
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id, sort_order);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  step_order integer not null,
  text text not null,
  timestamp_sec integer not null default 0 check (timestamp_sec >= 0)
);

create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id, step_order);

create table public.recipe_members (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (recipe_id, member_id)
);

create index recipe_members_member_id_idx on public.recipe_members (member_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipes_set_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.members enable row level security;
alter table public.video_analyses enable row level security;
alter table public.analysis_failures enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.recipe_members enable row level security;

create policy "profiles select own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "categories select defaults and own" on public.categories
  for select using (is_default or auth.uid() = user_id);
create policy "categories insert own" on public.categories
  for insert with check (auth.uid() = user_id and not is_default);
create policy "categories update own" on public.categories
  for update using (auth.uid() = user_id and not is_default)
  with check (auth.uid() = user_id and not is_default);
create policy "categories delete own" on public.categories
  for delete using (auth.uid() = user_id and not is_default);

create policy "members all own" on public.members
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "video analyses read authenticated" on public.video_analyses
  for select to authenticated using (true);

create policy "analysis failures insert own" on public.analysis_failures
  for insert with check (auth.uid() = user_id);
create policy "analysis failures select own" on public.analysis_failures
  for select using (auth.uid() = user_id);

create policy "recipes all own" on public.recipes
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recipe ingredients all via recipe owner" on public.recipe_ingredients
  for all using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
  );

create policy "recipe steps all via recipe owner" on public.recipe_steps
  for all using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
  );

create policy "recipe members all via owned recipe and member" on public.recipe_members
  for all using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.user_id = auth.uid()
    )
    and exists (
      select 1 from public.members m
      where m.id = member_id and m.user_id = auth.uid()
    )
  );
