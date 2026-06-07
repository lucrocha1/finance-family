-- Fix do bug crítico de transferência entre contas.
--
-- Antes: ambas as rows de uma transferência tinham type='transfer' e
-- amount positivo. O trigger SUM aplicava -amount pra ambas, fazendo
-- com que tanto a conta de origem quanto a de destino fossem DEBITADAS
-- (perda dupla no saldo total).
--
-- Solução: adicionar coluna transfer_direction ('out' | 'in') pra
-- identificar qual lado é entrada/saída. Trigger inverte sinal pra
-- 'in'. Form vai setar direction='out' na row da conta origem e
-- direction='in' na row da conta destino.
--
-- Migração de dados existente: pra cada par de transfer (mesmo family_id,
-- type='transfer', mesma date, mesma amount, criadas no mesmo segundo),
-- a primeira (menor id ordenado) vira 'out' e a segunda vira 'in'.

alter table public.transactions
  add column if not exists transfer_direction text
    check (transfer_direction in ('out', 'in') or transfer_direction is null);

-- Backfill: tenta parear rows de transfer existentes
with paired as (
  select
    id,
    row_number() over (
      partition by family_id, type, amount, date
      order by created_at asc, id asc
    ) as rn
  from public.transactions
  where type = 'transfer'
    and transfer_direction is null
)
update public.transactions t
set transfer_direction = case when p.rn = 1 then 'out' else 'in' end
from paired p
where t.id = p.id;

-- Atualiza o trigger pra usar transfer_direction
create or replace function public.recompute_account_balance(_account_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.accounts a
  set balance = coalesce((
    select sum(
      case
        when t.type = 'income' then t.amount
        when t.type = 'transfer' and t.transfer_direction = 'in' then t.amount
        else -t.amount
      end
    )
    from public.transactions t
    where t.account_id = _account_id
      and t.status = 'paid'
      and t.card_id is null
      and t.type in ('income', 'expense', 'transfer')
  ), 0)
  where a.id = _account_id;
$$;

-- Recomputa saldos de todas as contas com transferências afetadas
update public.accounts a
set balance = coalesce((
  select sum(
    case
      when t.type = 'income' then t.amount
      when t.type = 'transfer' and t.transfer_direction = 'in' then t.amount
      else -t.amount
    end
  )
  from public.transactions t
  where t.account_id = a.id
    and t.status = 'paid'
    and t.card_id is null
    and t.type in ('income', 'expense', 'transfer')
), 0);
