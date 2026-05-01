-- Estende create_linked_transaction pra suportar recorrência: quando uma
-- transação vinculada é marcada como recorrente, os DOIS parents (meu e do
-- outro membro) ficam marcados como recurrent. Como o gerador client-side
-- não consegue inserir com user_id alheio (RLS por-user), criamos uma RPC
-- security definer que gera os pares mês-a-mês.

drop function if exists public.create_linked_transaction(numeric, date, text, text, text, uuid, uuid, uuid, text);

create or replace function public.create_linked_transaction(
  p_amount numeric,
  p_date date,
  p_description text,
  p_type text,
  p_status text,
  p_other_user_id uuid,
  p_category_id uuid default null,
  p_account_id uuid default null,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_recurrence_type text default null,
  p_recurrence_day int default null,
  p_recurrence_end_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_my_user_id uuid := auth.uid();
  v_pair_id uuid := gen_random_uuid();
  v_my_tx_id uuid;
  v_other_type text;
begin
  if v_my_user_id is null then raise exception 'auth required'; end if;
  if p_other_user_id = v_my_user_id then raise exception 'cannot link to self'; end if;

  select fm.family_id into v_family_id
  from public.family_members fm
  where fm.user_id = v_my_user_id
    and exists (
      select 1 from public.family_members fm2
      where fm2.family_id = fm.family_id and fm2.user_id = p_other_user_id
    )
  limit 1;
  if v_family_id is null then raise exception 'users not in same family'; end if;

  v_other_type := case when p_type = 'income' then 'expense' else 'income' end;

  insert into public.transactions (
    family_id, user_id, type, description, amount, date, status,
    category_id, account_id, notes, linked_user_id, linked_pair_id,
    is_recurring, recurrence_type, recurrence_day, recurrence_end_date
  )
  values (
    v_family_id, v_my_user_id, p_type, p_description, p_amount, p_date, p_status,
    p_category_id, p_account_id, p_notes, p_other_user_id, v_pair_id,
    coalesce(p_is_recurring, false), p_recurrence_type, p_recurrence_day, p_recurrence_end_date
  )
  returning id into v_my_tx_id;

  insert into public.transactions (
    family_id, user_id, type, description, amount, date, status,
    notes, linked_user_id, linked_pair_id,
    is_recurring, recurrence_type, recurrence_day, recurrence_end_date
  )
  values (
    v_family_id, p_other_user_id, v_other_type, p_description, p_amount, p_date, 'pending',
    p_notes, v_my_user_id, v_pair_id,
    coalesce(p_is_recurring, false), p_recurrence_type, p_recurrence_day, p_recurrence_end_date
  );

  return v_my_tx_id;
end;
$$;

grant execute on function public.create_linked_transaction(numeric, date, text, text, text, uuid, uuid, uuid, text, boolean, text, int, date) to authenticated;

-- Gera pares de filhas mensais/semanais/anuais até 90 dias à frente, ou até
-- recurrence_end_date se vier antes. Cada mês vira um par com seu próprio
-- linked_pair_id (independente dos parents).
create or replace function public.generate_linked_pair_recurrences(p_my_parent_id uuid)
returns int
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
  v_horizon date := (current_date + interval '90 days')::date;
  v_cap date;
  v_anchor int;
  v_pair_id uuid;
  v_created int := 0;
  v_my_tx_id uuid;
begin
  if v_my_user_id is null then raise exception 'auth required'; end if;

  select * into v_my_parent from public.transactions
  where id = p_my_parent_id and user_id = v_my_user_id;
  if not found then raise exception 'parent not found or not yours'; end if;
  if not coalesce(v_my_parent.is_recurring, false) then return 0; end if;
  if v_my_parent.linked_pair_id is null or v_my_parent.linked_user_id is null then return 0; end if;
  if v_my_parent.recurrence_parent_id is not null then return 0; end if;

  -- Encontra o parent espelho do outro membro pelo linked_pair_id
  select * into v_other_parent from public.transactions
  where linked_pair_id = v_my_parent.linked_pair_id
    and user_id = v_my_parent.linked_user_id
    and recurrence_parent_id is null
  limit 1;
  if not found then raise exception 'mirror parent not found'; end if;

  -- Última data já existente entre parent + filhos do meu lado
  select max(date) into v_latest_date from public.transactions
  where (id = v_my_parent.id or recurrence_parent_id = v_my_parent.id);
  if v_latest_date is null then v_latest_date := v_my_parent.date; end if;

  v_cap := v_horizon;
  if v_my_parent.recurrence_end_date is not null and v_my_parent.recurrence_end_date < v_horizon then
    v_cap := v_my_parent.recurrence_end_date;
  end if;

  v_anchor := v_my_parent.recurrence_day;

  loop
    -- Calcula próxima ocorrência
    if v_my_parent.recurrence_type = 'weekly' then
      v_next_date := v_latest_date + interval '7 days';
    elsif v_my_parent.recurrence_type = 'yearly' then
      v_next_date := (v_latest_date + interval '1 year')::date;
    else
      -- monthly: avança 1 mês e ancora no recurrence_day (clampado ao último dia)
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

    -- Cria o par para esse mês com pair_id independente
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

grant execute on function public.generate_linked_pair_recurrences(uuid) to authenticated;
