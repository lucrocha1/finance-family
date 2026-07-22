-- Fase 3 — subsistema de dívidas. Torna o ledger de debt_payments a fonte da
-- verdade e liga o pagamento à transação bancária.
--
-- F19/F44: debt_payments.transaction_id referencia a transação criada quando o
-- pagamento debita/credita uma conta, pra que excluir o pagamento (ou a dívida)
-- reverta o saldo. ON DELETE SET NULL evita erro se a transação sumir antes.
alter table public.debt_payments
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

-- F22/F17/F3/F18: trigger recalcula amount_paid, installments_paid, status e
-- due_date a partir da SOMA dos pagamentos (fim do read-modify-write / lost
-- update). installments_paid é derivado por floor(total_pago / valor_parcela)
-- (+1 centavo de tolerância pro resíduo de arredondamento), então um pagamento
-- PARCIAL não fecha uma parcela inteira (F17) e pagar 2x a parcela avança 2
-- (não 1). status vira paid_off quando todas as parcelas fecham (ou o total é
-- atingido, com tolerância — F3). due_date aponta pra próxima parcela em aberto
-- (não some pra depois do fim do empréstimo — F18).
create or replace function public.debts_recompute_from_payments()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  did uuid := coalesce(new.debt_id, old.debt_id);
  total_paid numeric;
  d public.debts;
  inst_paid int;
  is_paid boolean;
  next_open int;
begin
  select coalesce(sum(p.amount), 0) into total_paid
  from public.debt_payments p where p.debt_id = did;

  select * into d from public.debts where id = did;
  if not found then return coalesce(new, old); end if;

  if d.has_installments and coalesce(d.installment_amount, 0) > 0 then
    inst_paid := least(floor((total_paid + 0.01) / d.installment_amount)::int, coalesce(d.total_installments, 0));
  else
    inst_paid := d.installments_paid;
  end if;

  if d.has_installments and coalesce(d.total_installments, 0) > 0 then
    is_paid := inst_paid >= d.total_installments;
  else
    is_paid := total_paid >= coalesce(d.total_with_interest, d.original_amount) - 0.01;
  end if;

  next_open := case
    when d.has_installments and coalesce(d.total_installments, 0) > 0
      then least(coalesce(inst_paid, 0) + 1, d.total_installments)
    else null
  end;

  update public.debts g
  set amount_paid = total_paid,
      installments_paid = case when g.has_installments then inst_paid else g.installments_paid end,
      status = case
        when g.status = 'renegotiated' then 'renegotiated'
        when is_paid then 'paid_off'
        else 'active'
      end,
      due_date = case
        when g.has_installments and next_open is not null
          then (g.start_date + (next_open || ' months')::interval)::date
        else g.due_date
      end
  where g.id = did;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists debt_payments_recompute on public.debt_payments;
create trigger debt_payments_recompute
after insert or update or delete on public.debt_payments
for each row execute function public.debts_recompute_from_payments();
