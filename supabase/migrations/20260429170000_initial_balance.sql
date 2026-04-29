-- Preserve account initial balance.
-- The previous trigger overwrote accounts.balance with SUM(transactions),
-- which means a manually-entered opening balance disappeared the moment
-- any transaction touched the account. Solution: split into two columns
-- — initial_balance (set by user, immutable from the trigger's view) and
-- balance (initial_balance + sum of paid transactions, kept in sync by
-- the trigger).

begin;

alter table public.accounts
  add column if not exists initial_balance numeric(14, 2) not null default 0;

-- Backfill: for existing accounts, treat the current balance as the
-- initial balance (since transactions weren't being applied to it
-- correctly anyway under the old trigger).
update public.accounts
set initial_balance = balance
where initial_balance = 0 and balance <> 0;

create or replace function public.recompute_account_balance(_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.accounts a
  set balance = coalesce(a.initial_balance, 0) + coalesce((
    select sum(case when t.type = 'income' then t.amount else -t.amount end)
    from public.transactions t
    where t.account_id = _account_id
      and t.status = 'paid'
      and t.card_id is null
      and t.type in ('income', 'expense', 'transfer')
  ), 0)
  where a.id = _account_id;
$$;

-- Refresh balances using the new formula
update public.accounts a
set balance = coalesce(a.initial_balance, 0) + coalesce((
  select sum(case when t.type = 'income' then t.amount else -t.amount end)
  from public.transactions t
  where t.account_id = a.id
    and t.status = 'paid'
    and t.card_id is null
    and t.type in ('income', 'expense', 'transfer')
), 0);

-- Trigger: recompute balance when initial_balance changes (or on insert)
create or replace function public.accounts_recompute_on_initial_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.initial_balance is distinct from old.initial_balance then
    perform public.recompute_account_balance(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_recompute_initial on public.accounts;
create trigger accounts_recompute_initial
  after insert or update of initial_balance on public.accounts
  for each row execute function public.accounts_recompute_on_initial_change();

commit;
