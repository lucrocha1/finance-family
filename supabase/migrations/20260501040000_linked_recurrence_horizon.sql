-- Parametriza o horizonte da geração de pares vinculados. Antes: hardcoded
-- 90 dias. Agora: parâmetro p_horizon_days (default 90 pra compatibilidade
-- com chamadas antigas). Permite ao client estender quando o usuário navega
-- pra meses muito futuros.

drop function if exists public.generate_linked_pair_recurrences(uuid);

create or replace function public.generate_linked_pair_recurrences(
  p_my_parent_id uuid,
  p_horizon_days int default 90
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_my_user_id uuid := auth.uid();
  v_my_parent public.transactions%rowtype;
  v_other_parent public.transactions%rowtype;
  v_latest_date date;
  v_next_date date;
  v_horizon date;
  v_cap date;
  v_anchor int;
  v_pair_id uuid;
  v_created int := 0;
  v_my_tx_id uuid;
begin
  if v_my_user_id is null then raise exception 'auth required'; end if;
  if p_horizon_days is null or p_horizon_days < 1 then p_horizon_days := 90; end if;
  v_horizon := (current_date + (p_horizon_days || ' days')::interval)::date;

  select * into v_my_parent from public.transactions
  where id = p_my_parent_id and user_id = v_my_user_id;
  if not found then raise exception 'parent not found or not yours'; end if;
  if not coalesce(v_my_parent.is_recurring, false) then return 0; end if;
  if v_my_parent.linked_pair_id is null or v_my_parent.linked_user_id is null then return 0; end if;
  if v_my_parent.recurrence_parent_id is not null then return 0; end if;

  select * into v_other_parent from public.transactions
  where linked_pair_id = v_my_parent.linked_pair_id
    and user_id = v_my_parent.linked_user_id
    and recurrence_parent_id is null
  limit 1;
  if not found then raise exception 'mirror parent not found'; end if;

  select max(date) into v_latest_date from public.transactions
  where (id = v_my_parent.id or recurrence_parent_id = v_my_parent.id);
  if v_latest_date is null then v_latest_date := v_my_parent.date; end if;

  v_cap := v_horizon;
  if v_my_parent.recurrence_end_date is not null and v_my_parent.recurrence_end_date < v_horizon then
    v_cap := v_my_parent.recurrence_end_date;
  end if;

  v_anchor := v_my_parent.recurrence_day;

  loop
    if v_my_parent.recurrence_type = 'weekly' then
      v_next_date := v_latest_date + interval '7 days';
    elsif v_my_parent.recurrence_type = 'yearly' then
      v_next_date := (v_latest_date + interval '1 year')::date;
    else
      v_next_date := (date_trunc('month', v_latest_date) + interval '1 month')::date;
      if v_anchor is not null then
        v_next_date := make_date(
          extract(year from v_next_date)::int,
          extract(month from v_next_date)::int,
          least(v_anchor, extract(day from (date_trunc('month', v_next_date) + interval '1 month - 1 day'))::int)
        );
      end if;
    end if;

    exit when v_next_date > v_cap;

    v_pair_id := gen_random_uuid();

    insert into public.transactions (
      family_id, user_id, type, description, amount, date, status,
      category_id, account_id, notes,
      linked_user_id, linked_pair_id,
      is_recurring, recurrence_parent_id
    )
    values (
      v_my_parent.family_id, v_my_parent.user_id, v_my_parent.type, v_my_parent.description,
      v_my_parent.amount, v_next_date, 'pending',
      v_my_parent.category_id, v_my_parent.account_id, v_my_parent.notes,
      v_my_parent.linked_user_id, v_pair_id,
      false, v_my_parent.id
    )
    returning id into v_my_tx_id;

    insert into public.transactions (
      family_id, user_id, type, description, amount, date, status,
      notes,
      linked_user_id, linked_pair_id,
      is_recurring, recurrence_parent_id
    )
    values (
      v_other_parent.family_id, v_other_parent.user_id, v_other_parent.type, v_other_parent.description,
      v_other_parent.amount, v_next_date, 'pending',
      v_other_parent.notes,
      v_other_parent.linked_user_id, v_pair_id,
      false, v_other_parent.id
    );

    v_created := v_created + 1;
    v_latest_date := v_next_date;
  end loop;

  return v_created;
end;
$$;

grant execute on function public.generate_linked_pair_recurrences(uuid, int) to authenticated;
