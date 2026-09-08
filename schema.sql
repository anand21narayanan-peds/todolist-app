/*
  Cute To-Do — Supabase (Postgres) schema

  Paste the whole thing into the Supabase SQL editor and run it once.
  Safe to re-run: every object is created "if not exists" or replaced.

  Three things are enforced here rather than in the app, because the
  database is the only place a rule cannot be skipped:

    * ownership   — row level security scopes every row to its owner
    * the 4/4/4 caps — BEFORE INSERT triggers, which Postgres can express
                       and SQLite could not
    * ordering    — position is assigned server-side, never sent by the client
*/

/* ------------------------------------------------------------------ tables */

create table if not exists public.goals (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name       text        not null check (btrim(name) <> '' and char_length(name) <= 80),
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.systems (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id    uuid        not null references public.goals(id) on delete cascade,
  name       text        not null check (btrim(name) <> '' and char_length(name) <= 80),
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  system_id  uuid        not null references public.systems(id) on delete cascade,
  title      text        not null check (btrim(title) <> '' and char_length(title) <= 90),
  dod        text        not null default '' check (char_length(dod) <= 110),
  done       boolean     not null default false,
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

/*
  UI state that belongs to the account rather than to a device: which goal
  tab was open, which systems were expanded. One row per person — this is
  what makes a phone and a laptop feel like the same app.
*/
create table if not exists public.prefs (
  user_id uuid  primary key default auth.uid() references auth.users(id) on delete cascade,
  sel     integer not null default 0,
  open    jsonb   not null default '[]'::jsonb
);

create index if not exists idx_systems_goal   on public.systems(goal_id, position);
create index if not exists idx_tasks_system   on public.tasks(system_id, position);
create index if not exists idx_goals_user     on public.goals(user_id, position);

/* ------------------------------------------------- caps, ordering, ownership */

create or replace function public.before_goal_insert() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.goals where user_id = new.user_id) >= 4 then
    raise exception 'You can have at most 4 goals.' using errcode = 'check_violation';
  end if;
  new.position := coalesce(
    (select max(position) + 1 from public.goals where user_id = new.user_id), 0);
  return new;
end $$;

create or replace function public.before_system_insert() returns trigger
language plpgsql as $$
declare parent_owner uuid;
begin
  /* RLS means a goal belonging to someone else simply is not visible here. */
  select user_id into parent_owner from public.goals where id = new.goal_id;
  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'That goal does not exist.' using errcode = 'insufficient_privilege';
  end if;

  if (select count(*) from public.systems where goal_id = new.goal_id) >= 4 then
    raise exception 'A goal can hold at most 4 systems.' using errcode = 'check_violation';
  end if;

  new.position := coalesce(
    (select max(position) + 1 from public.systems where goal_id = new.goal_id), 0);
  return new;
end $$;

create or replace function public.before_task_insert() returns trigger
language plpgsql as $$
declare parent_owner uuid;
begin
  select user_id into parent_owner from public.systems where id = new.system_id;
  if parent_owner is null or parent_owner <> new.user_id then
    raise exception 'That system does not exist.' using errcode = 'insufficient_privilege';
  end if;

  if (select count(*) from public.tasks where system_id = new.system_id) >= 4 then
    raise exception 'A system can hold at most 4 tasks.' using errcode = 'check_violation';
  end if;

  new.position := coalesce(
    (select max(position) + 1 from public.tasks where system_id = new.system_id), 0);
  return new;
end $$;

drop trigger if exists goals_before_insert   on public.goals;
drop trigger if exists systems_before_insert on public.systems;
drop trigger if exists tasks_before_insert   on public.tasks;

create trigger goals_before_insert
  before insert on public.goals
  for each row execute function public.before_goal_insert();

create trigger systems_before_insert
  before insert on public.systems
  for each row execute function public.before_system_insert();

create trigger tasks_before_insert
  before insert on public.tasks
  for each row execute function public.before_task_insert();

/* ------------------------------------------------------- row level security */

alter table public.goals   enable row level security;
alter table public.systems enable row level security;
alter table public.tasks   enable row level security;
alter table public.prefs   enable row level security;

drop policy if exists own_goals   on public.goals;
drop policy if exists own_systems on public.systems;
drop policy if exists own_tasks   on public.tasks;
drop policy if exists own_prefs   on public.prefs;

create policy own_goals on public.goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_systems on public.systems
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_tasks on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy own_prefs on public.prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ------------------------------------------------------------------ realtime */

/*
  Lets other devices update live instead of only on refocus. Skipped
  automatically when the publication is absent, so this file also runs
  against a plain Postgres.
*/
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.goals, public.systems, public.tasks;
  end if;
exception
  when duplicate_object then null;
end $$;
