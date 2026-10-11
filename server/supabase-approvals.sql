-- For the full storage and approval setup, run server/supabase.sql instead.
-- Account approval for Hive. Run once in the Supabase SQL editor.
-- Every account gets a row in public.profiles; new ones start with approved = false.
-- Approve someone in Table Editor -> profiles: tick "approved" on their row.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- People can read only their own row (the Hive server checks it with the person's own token).
-- Nobody can write through the API; approval is done in the dashboard.
alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);

-- A row for every new account, not approved.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, login)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts without a profile are approved; preserve later manual approval decisions on rerun.
insert into public.profiles (id, login, approved)
select id, coalesce(raw_user_meta_data ->> 'user_name', raw_user_meta_data ->> 'preferred_username', email), true
from auth.users
on conflict (id) do nothing;

-- People to share a project with: every account that has signed in, matched by GitHub username or name.
-- Only an approved person can call it (the Hive server calls it with the person's own token).
-- Returns no emails or tokens, only what is shown on an avatar.
create or replace function public.hive_people(q text default '')
returns table (login text, name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select l.login, l.name, l.avatar_url from (
    select coalesce(u.raw_user_meta_data ->> 'user_name', u.raw_user_meta_data ->> 'preferred_username') as login,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '') as name,
           coalesce(u.raw_user_meta_data ->> 'avatar_url', '') as avatar_url
    from auth.users u
  ) l
  where l.login is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.approved)
    and (coalesce(q, '') = '' or l.login ilike '%' || q || '%' or l.name ilike '%' || q || '%')
  order by l.login
  limit 25;
$$;
revoke execute on function public.hive_people(text) from public, anon;
grant execute on function public.hive_people(text) to authenticated;
