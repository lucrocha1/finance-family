-- Fix: infinite recursion detected in policy for relation "family_members"
-- This migration resets family-related RLS policies and recreates them using
-- SECURITY DEFINER helpers to avoid recursive policy evaluation.

begin;

create or replace function public.is_family_member(_family_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = _family_id
      and fm.user_id = _user_id
  );
$$;

create or replace function public.is_family_admin(_family_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = _family_id
      and fm.user_id = _user_id
      and fm.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'families', 'family_members')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

create policy "profiles_select_self_or_same_family"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or (family_id is not null and public.is_family_member(family_id, auth.uid()))
);

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "families_select_by_membership"
on public.families
for select
to authenticated
using (public.is_family_member(id, auth.uid()));

create policy "families_update_admin"
on public.families
for update
to authenticated
using (public.is_family_admin(id, auth.uid()))
with check (public.is_family_admin(id, auth.uid()));

create policy "family_members_select_same_family"
on public.family_members
for select
to authenticated
using (public.is_family_member(family_id, auth.uid()));

create policy "family_members_insert_self"
on public.family_members
for insert
to authenticated
with check (user_id = auth.uid());

create policy "family_members_delete_admin"
on public.family_members
for delete
to authenticated
using (public.is_family_admin(family_id, auth.uid()));

create policy "family_members_update_admin"
on public.family_members
for update
to authenticated
using (public.is_family_admin(family_id, auth.uid()))
with check (public.is_family_admin(family_id, auth.uid()));

commit;
