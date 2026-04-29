-- Account balance: keep accounts.balance in sync with paid transactions.
-- Income credits the account, expense debits, transfer moves between two
-- accounts. Card-funded expenses do NOT touch the account (they live in
-- the card invoice cycle until paid).
--
-- The trigger recomputes balances for the touched accounts after every
-- INSERT, UPDATE or DELETE.

begin;

create or replace function public.recompute_account_balance(_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.accounts a
  set balance = coalesce((
    select sum(case when t.type = 'income' then t.amount else -t.amount end)
    from public.transactions t
    where t.account_id = _account_id
      and t.status = 'paid'
      and t.card_id is null
      and t.type in ('income', 'expense', 'transfer')
  ), 0)
  where a.id = _account_id;
$$;

create or replace function public.transactions_touch_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[] := array[]::uuid[];
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.account_id is not null then
    ids := array_append(ids, new.account_id);
  end if;
  if (tg_op = 'UPDATE' or tg_op = 'DELETE') and old.account_id is not null then
    if old.account_id is distinct from coalesce(new.account_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      ids := array_append(ids, old.account_id);
    end if;
  end if;

  -- Deduplicate
  ids := (select array_agg(distinct x) from unnest(ids) as x);

  if ids is not null then
    perform public.recompute_account_balance(x) from unnest(ids) as x;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists transactions_balance_after on public.transactions;
create trigger transactions_balance_after
  after insert or update or delete on public.transactions
  for each row execute function public.transactions_touch_balance();

-- One-time backfill for existing rows
update public.accounts a
set balance = coalesce((
  select sum(case when t.type = 'income' then t.amount else -t.amount end)
  from public.transactions t
  where t.account_id = a.id
    and t.status = 'paid'
    and t.card_id is null
    and t.type in ('income', 'expense', 'transfer')
), 0);

commit;
