alter table public.fridge_items
  drop constraint if exists fridge_items_storage_check;

alter table public.fridge_items
  add constraint fridge_items_storage_check
    check (storage in ('fridge', 'freezer', 'pantry'));
