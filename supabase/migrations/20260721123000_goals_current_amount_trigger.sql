-- F23/F25: current_amount da meta passa a ser DERIVADO da soma dos aportes
-- (goal_contributions), mantido por trigger. Antes o frontend fazia
-- read-modify-write no current_amount (lost update entre duas sessões — celular
-- + desktop) e ainda permitia editar o "valor atual" como número absoluto,
-- desincronizando permanentemente do ledger de aportes.
--
-- goals e goal_contributions estão vazias, então não há backfill necessário.

create or replace function public.goals_recompute_current()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  gid uuid := coalesce(new.goal_id, old.goal_id);
  total numeric;
begin
  select coalesce(sum(c.amount), 0) into total
  from public.goal_contributions c
  where c.goal_id = gid;

  update public.goals g
  set current_amount = total,
      status = case
        when g.status = 'paused' then 'paused'
        when total >= g.target_amount then 'completed'
        else 'active'
      end
  where g.id = gid;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists goal_contributions_recompute on public.goal_contributions;
create trigger goal_contributions_recompute
after insert or update or delete on public.goal_contributions
for each row execute function public.goals_recompute_current();
