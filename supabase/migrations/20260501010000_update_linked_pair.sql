-- Sincroniza edição entre as duas pontas de uma transação vinculada.
-- Atualiza apenas os campos compartilhados (amount, date, description, notes)
-- nos dois rows. status, account_id, category_id, card_id continuam
-- independentes — cada um quita/categoriza do seu lado.

create or replace function public.update_linked_pair(
  p_pair_id uuid,
  p_amount numeric,
  p_date date,
  p_description text,
  p_notes text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_user_id uuid := auth.uid();
  v_owns boolean;
begin
  if v_my_user_id is null then
    raise exception 'auth required';
  end if;

  select exists (
    select 1 from public.transactions
    where linked_pair_id = p_pair_id and user_id = v_my_user_id
  ) into v_owns;

  if not v_owns then
    raise exception 'not authorized';
  end if;

  update public.transactions
  set amount = p_amount,
      date = p_date,
      description = p_description,
      notes = p_notes
  where linked_pair_id = p_pair_id;
end;
$$;

grant execute on function public.update_linked_pair(uuid, numeric, date, text, text) to authenticated;
