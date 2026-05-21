alter table public.fridge_items
  add column if not exists purchased_at date,
  add column if not exists expires_at date;

create index if not exists fridge_items_user_expires_at_idx
  on public.fridge_items (user_id, expires_at);
