-- Inomesto: синхронизированные настройки и отметки прочитанного для уведомлений
-- Выполнить один раз в Supabase → SQL Editor → New query.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dm_enabled boolean not null default true,
  dm_delivery text not null default 'in_app' check (dm_delivery in ('in_app', 'browser', 'both')),
  space_badges boolean not null default true,
  comment_badges boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.notification_cursors (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('space_posts', 'space_comments', 'conversation')),
  scope_id uuid not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, scope_type, scope_id)
);
alter table public.notification_preferences enable row level security;
alter table public.notification_cursors enable row level security;
drop policy if exists "Users read own notification preferences" on public.notification_preferences;
create policy "Users read own notification preferences" on public.notification_preferences for select using (auth.uid() = user_id);
drop policy if exists "Users insert own notification preferences" on public.notification_preferences;
create policy "Users insert own notification preferences" on public.notification_preferences for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own notification preferences" on public.notification_preferences;
create policy "Users update own notification preferences" on public.notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users read own notification cursors" on public.notification_cursors;
create policy "Users read own notification cursors" on public.notification_cursors for select using (auth.uid() = user_id);
drop policy if exists "Users insert own notification cursors" on public.notification_cursors;
create policy "Users insert own notification cursors" on public.notification_cursors for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own notification cursors" on public.notification_cursors;
create policy "Users update own notification cursors" on public.notification_cursors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update on public.notification_cursors to authenticated;
