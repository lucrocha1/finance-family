-- Linked transactions: ao criar uma transação vinculada a outro membro da
-- família, gera um par de transações (uma pra cada usuário) com tipo
-- invertido. RLS por-user impede insert direto com user_id alheio, então
-- usamos RPCs security definer que validam que ambos estão na mesma família.

alter table public.transactions
  add column if not exists linked_user_id uuid references auth.users(id) on delete set null,
  add column if not exists linked_pair_id uuid;

create index if not exists transactions_linked_pair_id_idx on public.transactions (linked_pair_id);

create or replace function public.create_linked_transaction(
  p_amount numeric,
  p_date date,
  p_description text,
  p_type text,
  p_status text,
  p_other_user_id uuid,
  p_category_id uuid default null,
  p_account_id uuid default null,
  p_notes text default null
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
  v_other_status text;
begin
  if v_my_user_id is null then
    raise exception 'auth required';
  end if;

  if p_other_user_id = v_my_user_id then
    raise exception 'cannot link to self';
  end if;

  -- Garante que ambos estão na mesma família
  select fm.family_id into v_family_id
  from public.family_members fm
  where fm.user_id = v_my_user_id
    and exists (
      select 1 from public.family_members fm2
      where fm2.family_id = fm.family_id and fm2.user_id = p_other_user_id
    )
  limit 1;

  if v_family_id is null then
    raise exception 'users not in same family';
  end if;

  -- Espelho: tipo invertido, sempre pending até a outra pessoa quitar
  v_other_type := case when p_type = 'income' then 'expense' else 'income' end;
  v_other_status := 'pending';

  -- Insere a transação do criador (account/category podem existir)
  insert into public.transactions (
    family_id, user_id, type, description, amount, date, status,
    category_id, account_id, notes, linked_user_id, linked_pair_id
  )
  values (
    v_family_id, v_my_user_id, p_type, p_description, p_amount, p_date, p_status,
    p_category_id, p_account_id, p_notes, p_other_user_id, v_pair_id
  )
  returning id into v_my_tx_id;

  -- Insere o espelho do outro membro (sem account/category — pertencem ao criador)
  insert into public.transactions (
    family_id, user_id, type, description, amount, date, status,
    notes, linked_user_id, linked_pair_id
  )
  values (
    v_family_id, p_other_user_id, v_other_type, p_description, p_amount, p_date, v_other_status,
    p_notes, v_my_user_id, v_pair_id
  );

  return v_my_tx_id;
end;
$$;

grant execute on function public.create_linked_transaction(numeric, date, text, text, text, uuid, uuid, uuid, text) to authenticated;

create or replace function public.delete_linked_pair(p_pair_id uuid)
returns void
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

  -- Só pode remover o par se o usuário fizer parte de uma das pontas
  select exists (
    select 1 from public.transactions
    where linked_pair_id = p_pair_id and user_id = v_my_user_id
  ) into v_owns;

  if not v_owns then
    raise exception 'not authorized';
  end if;

  delete from public.transactions where linked_pair_id = p_pair_id;
end;
$$;

grant execute on function public.delete_linked_pair(uuid) to authenticated;
