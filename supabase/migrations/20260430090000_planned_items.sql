-- Items the user wants to do "someday" — future investments / expenses /
-- income without a definite date yet. Once a date is set, the user
-- "schedules" the item, which materialises it into the regular pending
-- transactions/investments flow and deletes the planned_items row.

begin;

create table if not exists public.planned_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  family_id uuid,
  kind text not null check (kind in ('investment', 'expense', 'income')),
  description text not null,
  amount numeric(14, 2) not null default 0,
  category_id uuid,
  account_id uuid,
  notes text,
  target_date date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create index if not exists idx_planned_items_user on public.planned_items(user_id);
create index if not exists idx_planned_items_kind on public.planned_items(kind);
create index if not exists idx_planned_items_user_kind on public.planned_items(user_id, kind);

alter table public.planned_items enable row level security;

do $$
declare
  pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'planned_items'
  loop
    execute format('drop policy if exists %I on public.planned_items', pol.policyname);
  end loop;
end $$;

create policy "planned_items_select_own" on public.planned_items
  for select to authenticated using (user_id = auth.uid());
create policy "planned_items_insert_own" on public.planned_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "planned_items_update_own" on public.planned_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "planned_items_delete_own" on public.planned_items
  for delete to authenticated using (user_id = auth.uid());

commit;
