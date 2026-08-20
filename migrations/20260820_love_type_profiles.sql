create table if not exists public.love_type_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1,
  type_code text not null check (type_code ~ '^[EI][SN][TF][JP]$'),
  type_name text not null,
  axis_scores jsonb not null,
  behavior_scores jsonb not null,
  answers jsonb not null,
  summary text not null default '',
  strength text not null default '',
  watchout text not null default '',
  strategy_fit text not null default '',
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.love_type_profiles enable row level security;

drop policy if exists "users read own love type" on public.love_type_profiles;
create policy "users read own love type" on public.love_type_profiles for select using (auth.uid() = user_id);

drop policy if exists "users insert own love type" on public.love_type_profiles;
create policy "users insert own love type" on public.love_type_profiles for insert with check (auth.uid() = user_id);

drop policy if exists "users update own love type" on public.love_type_profiles;
create policy "users update own love type" on public.love_type_profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
