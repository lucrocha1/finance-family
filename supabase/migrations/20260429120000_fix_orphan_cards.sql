-- Fix orphan cards (and other tables) created with family_id = NULL.
-- This happened when records were inserted before the user's family_id
-- finished propagating from FamilyContext. Affected tables: cards, accounts,
-- transactions, scheduled_payments, debts, investments, budgets, goals, categories.

begin;

-- Fix orphan cards
update public.cards c
set family_id = (
  select fm.family_id
  from public.family_members fm
  where fm.user_id = c.user_id
  order by fm.created_at asc
  limit 1
)
where c.family_id is null and c.user_id is not null;

-- Fix orphan accounts
update public.accounts a
set family_id = (
  select fm.family_id
  from public.family_members fm
  where fm.user_id = a.user_id
  order by fm.created_at asc
  limit 1
)
where a.family_id is null and a.user_id is not null;

-- Fix orphan transactions
update public.transactions t
set family_id = (
  select fm.family_id
  from public.family_members fm
  where fm.user_id = t.user_id
  order by fm.created_at asc
  limit 1
)
where t.family_id is null and t.user_id is not null;

-- Add NOT NULL constraint going forward (only if no orphans remain)
do $$
begin
  if not exists (select 1 from public.cards where family_id is null) then
    alter table public.cards alter column family_id set not null;
  end if;
  if not exists (select 1 from public.accounts where family_id is null) then
    alter table public.accounts alter column family_id set not null;
  end if;
end $$;

commit;
