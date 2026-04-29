begin;

create table if not exists public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  filename text not null,
  status text not null default 'done' check (status in ('done', 'error')),
  rows_imported integer not null default 0,
  rows_total integer not null default 0,
  column_mapping jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_csv_imports_family_created_at on public.csv_imports (family_id, created_at desc);
create index if not exists idx_csv_imports_user on public.csv_imports (user_id);

alter table public.csv_imports enable row level security;

drop policy if exists "csv_imports_select_family" on public.csv_imports;
create policy "csv_imports_select_family"
on public.csv_imports
for select
to authenticated
using (public.is_family_member(family_id, auth.uid()));

drop policy if exists "csv_imports_insert_owner_family" on public.csv_imports;
create policy "csv_imports_insert_owner_family"
on public.csv_imports
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_family_member(family_id, auth.uid())
);

drop policy if exists "csv_imports_update_family" on public.csv_imports;
create policy "csv_imports_update_family"
on public.csv_imports
for update
to authenticated
using (public.is_family_member(family_id, auth.uid()))
with check (public.is_family_member(family_id, auth.uid()));

drop policy if exists "csv_imports_delete_family" on public.csv_imports;
create policy "csv_imports_delete_family"
on public.csv_imports
for delete
to authenticated
using (public.is_family_member(family_id, auth.uid()));

commit;
