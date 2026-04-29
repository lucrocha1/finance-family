-- Switch all financial tables from family-wide visibility to per-user
-- isolation. Family stays as a logical grouping for member management
-- and a future "shared item" feature, but no financial row is visible
-- across users by default.
--
-- Affected tables: transactions, accounts, cards, debts, investments,
-- scheduled_payments, goals, budgets, categories, goal_contributions,
-- debt_payments, csv_imports.
--
-- Profiles, families and family_members keep their existing policies.

begin;

do $$
declare
  t text;
  pol record;
  tables text[] := array[
    'transactions',
    'accounts',
    'cards',
    'debts',
    'investments',
    'scheduled_payments',
    'goals',
    'budgets',
    'categories',
    'goal_contributions',
    'debt_payments',
    'csv_imports'
  ];
begin
  foreach t in array tables
  loop
    -- Skip silently if the table doesn't exist (e.g. csv_imports may not be created yet)
    if not exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for pol in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end
$$;

-- transactions, accounts, cards, debts, investments, scheduled_payments,
-- goals, budgets, categories: have user_id directly
do $$
declare
  t text;
  tables text[] := array[
    'transactions',
    'accounts',
    'cards',
    'debts',
    'investments',
    'scheduled_payments',
    'goals',
    'budgets',
    'categories'
  ];
begin
  foreach t in array tables
  loop
    if not exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = t
    ) then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      continue;
    end if;

    execute format($f$
      create policy "%1$s_select_own" on public.%1$I for select to authenticated using (user_id = auth.uid());
      create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check (user_id = auth.uid());
      create policy "%1$s_update_own" on public.%1$I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
      create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using (user_id = auth.uid());
    $f$, t);
  end loop;
end
$$;

-- Child tables that don't have user_id: scope through their parent.
-- goal_contributions inherits from goals; debt_payments from debts.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'goal_contributions') then
    create policy "goal_contributions_select_own" on public.goal_contributions
      for select to authenticated using (
        exists (select 1 from public.goals g where g.id = goal_contributions.goal_id and g.user_id = auth.uid())
      );
    create policy "goal_contributions_insert_own" on public.goal_contributions
      for insert to authenticated with check (
        exists (select 1 from public.goals g where g.id = goal_contributions.goal_id and g.user_id = auth.uid())
      );
    create policy "goal_contributions_update_own" on public.goal_contributions
      for update to authenticated using (
        exists (select 1 from public.goals g where g.id = goal_contributions.goal_id and g.user_id = auth.uid())
      )
      with check (
        exists (select 1 from public.goals g where g.id = goal_contributions.goal_id and g.user_id = auth.uid())
      );
    create policy "goal_contributions_delete_own" on public.goal_contributions
      for delete to authenticated using (
        exists (select 1 from public.goals g where g.id = goal_contributions.goal_id and g.user_id = auth.uid())
      );
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'debt_payments') then
    create policy "debt_payments_select_own" on public.debt_payments
      for select to authenticated using (
        exists (select 1 from public.debts d where d.id = debt_payments.debt_id and d.user_id = auth.uid())
      );
    create policy "debt_payments_insert_own" on public.debt_payments
      for insert to authenticated with check (
        exists (select 1 from public.debts d where d.id = debt_payments.debt_id and d.user_id = auth.uid())
      );
    create policy "debt_payments_update_own" on public.debt_payments
      for update to authenticated using (
        exists (select 1 from public.debts d where d.id = debt_payments.debt_id and d.user_id = auth.uid())
      )
      with check (
        exists (select 1 from public.debts d where d.id = debt_payments.debt_id and d.user_id = auth.uid())
      );
    create policy "debt_payments_delete_own" on public.debt_payments
      for delete to authenticated using (
        exists (select 1 from public.debts d where d.id = debt_payments.debt_id and d.user_id = auth.uid())
      );
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'csv_imports') then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'csv_imports' and column_name = 'user_id') then
      create policy "csv_imports_select_own" on public.csv_imports for select to authenticated using (user_id = auth.uid());
      create policy "csv_imports_insert_own" on public.csv_imports for insert to authenticated with check (user_id = auth.uid());
      create policy "csv_imports_update_own" on public.csv_imports for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
      create policy "csv_imports_delete_own" on public.csv_imports for delete to authenticated using (user_id = auth.uid());
    end if;
  end if;
end
$$;

commit;
