-- Grupos de orçamento (teto combinado sobre várias categorias). Aplicado via MCP.
-- Modelo: pertinência EXCLUSIVA (categoria em no máximo 1 grupo) + teto sticky
-- por mês espelhando budgets. Chaves UNIQUE por user_id (NÃO family_id — budgets
-- tem o bug de colidir entre membros da família). RLS own-row + triggers de posse
-- que também gravam family_id do próprio grupo (FK só checa existência, não posse).

create table if not exists public.budget_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_group_limits (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.budget_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  amount numeric not null check (amount >= 0),   -- 0 = marcador fim-de-vigência
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, group_id, month, year)
);

create table if not exists public.budget_group_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.budget_groups(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, category_id)   -- categoria em no máximo 1 grupo
);

create index if not exists idx_bgl_group_period on public.budget_group_limits (user_id, group_id, year, month);
create index if not exists idx_bgc_group on public.budget_group_categories (user_id, group_id);

alter table public.budget_groups enable row level security;
alter table public.budget_group_limits enable row level security;
alter table public.budget_group_categories enable row level security;

do $$
declare t text; tables text[] := array['budget_groups','budget_group_limits','budget_group_categories'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t||'_select_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_update_own', t);
    execute format('drop policy if exists %I on public.%I', t||'_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t||'_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', t||'_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t||'_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', t||'_delete_own', t);
  end loop;
end $$;

create or replace function public.validate_budget_group_category()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare g_user uuid; g_family uuid;
begin
  select user_id, family_id into g_user, g_family from public.budget_groups where id = new.group_id;
  if g_user is null or g_user <> new.user_id then
    raise exception 'grupo invalido: nao pertence ao usuario';
  end if;
  if not exists (select 1 from public.categories c
      where c.id = new.category_id and c.user_id = new.user_id
        and (c.type = 'expense' or c.type is null)) then
    raise exception 'categoria invalida: deve ser sua e do tipo despesa';
  end if;
  new.family_id := g_family;
  return new;
end $fn$;
drop trigger if exists trg_validate_bgc on public.budget_group_categories;
create trigger trg_validate_bgc before insert or update on public.budget_group_categories
  for each row execute function public.validate_budget_group_category();

create or replace function public.validate_budget_group_limit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare g_user uuid; g_family uuid;
begin
  select user_id, family_id into g_user, g_family from public.budget_groups where id = new.group_id;
  if g_user is null or g_user <> new.user_id then
    raise exception 'grupo invalido: nao pertence ao usuario';
  end if;
  new.family_id := g_family;
  return new;
end $fn$;
drop trigger if exists trg_validate_bgl on public.budget_group_limits;
create trigger trg_validate_bgl before insert or update on public.budget_group_limits
  for each row execute function public.validate_budget_group_limit();
