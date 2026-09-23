-- PhotoSeek — схема Supabase: профили пользователей + лог поисков для
-- админки. Выполните этот файл целиком один раз в Supabase Dashboard →
-- SQL Editor → New query → вставить → Run.

-- Один профиль на пользователя Supabase Auth. is_admin включает доступ
-- к /admin на сайте и к закрытым /admin/* эндпоинтам воркера.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Каждый видит (через сайт, с его собственным токеном) только свою строку.
create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);

-- insert/update/delete для профилей не разрешены обычным пользователям —
-- строка создаётся только триггером ниже, а is_admin меняется только через
-- Supabase Dashboard (Table Editor) или service_role (его использует Worker,
-- RLS на него не действует).

-- Автосоздание профиля сразу при регистрации нового пользователя.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Лог поисков — пишет только Cloudflare Worker (через service_role ключ,
-- он обходит RLS), поэтому никаких policies не заводим: обычным
-- пользователям (anon/authenticated) таблица недоступна ни на чтение, ни
-- на запись.
create table if not exists public.search_stats (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  query text,
  mode text,
  user_id uuid references auth.users (id) on delete set null
);

alter table public.search_stats enable row level security;
