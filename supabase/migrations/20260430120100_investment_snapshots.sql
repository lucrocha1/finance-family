-- Daily snapshots of investment current_value so the notification engine
-- can detect ±5% variation week-over-week without keeping a long history
-- in the investments row itself.

begin;

create table if not exists public.investment_snapshots (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investments(id) on delete cascade,
  user_id uuid not null,
  value numeric(14, 2) not null,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (investment_id, snapshot_date)
);

create index if not exists idx_snapshots_invest_date
  on public.investment_snapshots(investment_id, snapshot_date desc);

alter table public.investment_snapshots enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'investment_snapshots'
  loop
    execute format('drop policy if exists %I on public.investment_snapshots', pol.policyname);
  end loop;
end $$;

create policy "snap_select_own" on public.investment_snapshots
  for select to authenticated using (user_id = auth.uid());
-- Inserts via service_role only (Edge Function).

commit;
