begin;

-- Server-only application storage. Browser clients cannot read or modify these tables.
create table if not exists public.hive_projects (
  id text primary key,
  payload jsonb not null
);
create table if not exists public.hive_records (
  kind text not null,
  id text not null,
  project text references public.hive_projects(id) on delete cascade,
  payload jsonb not null,
  primary key (kind, id)
);
create index if not exists hive_records_project_kind on public.hive_records(project, kind);
create index if not exists hive_records_task_history on public.hive_records(project, (payload->>'taskId'), id) where kind = 'step';
alter table public.hive_projects enable row level security;
alter table public.hive_records enable row level security;
revoke all on public.hive_projects, public.hive_records from anon, authenticated;
grant all on public.hive_projects, public.hive_records to service_role;

-- Account approval. New signups are unapproved; users can only read their own profile.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, login)
  values(new.id, coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Existing accounts are approved on the first run. Reruns preserve manual approval decisions.
insert into public.profiles(id, login, approved)
select id, coalesce(raw_user_meta_data ->> 'user_name', raw_user_meta_data ->> 'preferred_username', email), true
from auth.users on conflict (id) do nothing;

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
commit;
