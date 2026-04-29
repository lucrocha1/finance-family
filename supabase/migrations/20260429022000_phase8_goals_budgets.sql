begin;

create type public.goal_status as enum ('active', 'paused', 'completed');

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, category_id, month, year)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  emoji text not null default '🎯',
  color text,
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  description text,
  status public.goal_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_budgets_family_period on public.budgets (family_id, year, month);
create index if not exists idx_goals_family_status on public.goals (family_id, status);
create index if not exists idx_goal_contributions_goal_date on public.goal_contributions (goal_id, date desc);
create index if not exists idx_goal_contributions_family on public.goal_contributions (family_id);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at
before update on public.budgets
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
before update on public.goals
for each row execute function public.set_updated_at_timestamp();

alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;

drop policy if exists "budgets_select_family" on public.budgets;
create policy "budgets_select_family"
on public.budgets
for select
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "budgets_insert_owner_family" on public.budgets;
create policy "budgets_insert_owner_family"
on public.budgets
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_family_member(family_id, auth.uid())
);

drop policy if exists "budgets_update_family" on public.budgets;
create policy "budgets_update_family"
on public.budgets
for update
to authenticated
using (public.is_family_member(family_id, auth.uid()))
with check (public.is_family_member(family_id, auth.uid()));

drop policy if exists "budgets_delete_family" on public.budgets;
create policy "budgets_delete_family"
on public.budgets
for delete
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goals_select_family" on public.goals;
create policy "goals_select_family"
on public.goals
for select
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goals_insert_owner_family" on public.goals;
create policy "goals_insert_owner_family"
on public.goals
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_family_member(family_id, auth.uid())
);

drop policy if exists "goals_update_family" on public.goals;
create policy "goals_update_family"
on public.goals
for update
to authenticated
using (public.is_family_member(family_id, auth.uid()))
with check (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goals_delete_family" on public.goals;
create policy "goals_delete_family"
on public.goals
for delete
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goal_contributions_select_family" on public.goal_contributions;
create policy "goal_contributions_select_family"
on public.goal_contributions
for select
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goal_contributions_insert_owner_family" on public.goal_contributions;
create policy "goal_contributions_insert_owner_family"
on public.goal_contributions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_family_member(family_id, auth.uid())
);

drop policy if exists "goal_contributions_update_family" on public.goal_contributions;
create policy "goal_contributions_update_family"
on public.goal_contributions
for update
to authenticated
using (public.is_family_member(family_id, auth.uid()))
with check (public.is_family_member(family_id, auth.uid()));

drop policy if exists "goal_contributions_delete_family" on public.goal_contributions;
create policy "goal_contributions_delete_family"
on public.goal_contributions
for delete
to authenticated
using (public.is_family_member(family_id, auth.uid()));

commit;
