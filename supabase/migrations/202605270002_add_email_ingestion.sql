-- 이메일 연동 (Gmail 등) refresh_token 저장
create table if not exists public.email_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  email_address text not null,
  refresh_token text not null,
  history_id text,
  last_synced_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

create index if not exists email_integrations_user_idx
  on public.email_integrations (user_id, is_active);

drop trigger if exists email_integrations_set_updated_at on public.email_integrations;
create trigger email_integrations_set_updated_at
before update on public.email_integrations
for each row execute function public.set_updated_at();

alter table public.email_integrations enable row level security;

drop policy if exists "email integrations own select" on public.email_integrations;
create policy "email integrations own select" on public.email_integrations
  for select using (auth.uid() = user_id);

drop policy if exists "email integrations own delete" on public.email_integrations;
create policy "email integrations own delete" on public.email_integrations
  for delete using (auth.uid() = user_id);
-- INSERT/UPDATE는 service role(Edge Function)에서만 수행

-- 처리한 메일 추적 (중복 방지 + 디버깅용)
create table if not exists public.processed_emails (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.email_integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  thread_id text,
  from_address text,
  subject text,
  received_at timestamptz,
  status text not null default 'parsed' check (status in ('parsed', 'skipped', 'failed')),
  parsed_items jsonb,
  fridge_item_ids uuid[] default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  unique (integration_id, message_id)
);

create index if not exists processed_emails_user_idx
  on public.processed_emails (user_id, created_at desc);

alter table public.processed_emails enable row level security;

drop policy if exists "processed emails own select" on public.processed_emails;
create policy "processed emails own select" on public.processed_emails
  for select using (auth.uid() = user_id);
