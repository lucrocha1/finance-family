-- F12/F40: recompute_account_balance havia perdido o initial_balance.
-- A definição vigente calculava balance = soma das transações pagas, SEM o termo
-- coalesce(a.initial_balance, 0) +. Assim, o saldo de abertura cadastrado pelo
-- usuário era descartado silenciosamente (ex.: conta com R$ 692,00 de abertura e
-- -R$ 394,12 de movimento mostrava -R$ 394,12 em vez do correto R$ 297,88).
--
-- Recria a função incluindo o saldo inicial e re-executa o backfill de todas as
-- contas. A direção da transferência é respeitada: 'in' credita, 'out'/demais
-- debita. Combina com o fix de Settings.tsx (F1/F42), onde o form passa a editar
-- o saldo INICIAL e não grava mais `balance` (deixado a cargo deste trigger).

create or replace function public.recompute_account_balance(_account_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.accounts a
  set balance = coalesce(a.initial_balance, 0) + coalesce((
    select sum(case
      when t.type = 'income' then t.amount
      when t.type = 'transfer' and t.transfer_direction = 'in' then t.amount
      else -t.amount
    end)
    from public.transactions t
    where t.account_id = _account_id and t.status = 'paid'
      and t.card_id is null and t.type in ('income', 'expense', 'transfer')
  ), 0)
  where a.id = _account_id;
$function$;

-- Backfill: recomputa o saldo de todas as contas com a fórmula corrigida.
update public.accounts a
set balance = coalesce(a.initial_balance, 0) + coalesce((
  select sum(case
    when t.type = 'income' then t.amount
    when t.type = 'transfer' and t.transfer_direction = 'in' then t.amount
    else -t.amount
  end)
  from public.transactions t
  where t.account_id = a.id and t.status = 'paid'
    and t.card_id is null and t.type in ('income', 'expense', 'transfer')
), 0);
