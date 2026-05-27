alter table public.fridge_items
  add column if not exists storage text not null default 'fridge';

alter table public.fridge_items
  drop constraint if exists fridge_items_storage_check;
alter table public.fridge_items
  add constraint fridge_items_storage_check
    check (storage in ('fridge', 'pantry'));

create index if not exists fridge_items_user_storage_idx
  on public.fridge_items (user_id, storage);
