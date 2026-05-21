create table if not exists public.fridge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_local_id text,
  name text not null,
  checked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fridge_items_user_source_local_id_key unique (user_id, source_local_id)
);

create index if not exists fridge_items_user_id_idx
  on public.fridge_items (user_id, created_at);

drop trigger if exists fridge_items_set_updated_at on public.fridge_items;
create trigger fridge_items_set_updated_at
before update on public.fridge_items
for each row execute function public.set_updated_at();

alter table public.fridge_items enable row level security;

drop policy if exists "fridge items all own" on public.fridge_items;
create policy "fridge items all own" on public.fridge_items
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
