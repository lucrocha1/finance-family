-- Recurrence: parent transaction + auto-generated child instances.
-- Schema already has is_recurring (bool) and recurrence_type (text).
-- Add: end_date, parent reference, day-of-month anchor, last_generated_at.

begin;

alter table public.transactions
  add column if not exists recurrence_end_date date,
  add column if not exists recurrence_parent_id uuid references public.transactions(id) on delete set null,
  add column if not exists recurrence_day integer,
  add column if not exists recurrence_last_generated_at timestamptz;

create index if not exists idx_transactions_recurrence_parent
  on public.transactions(recurrence_parent_id)
  where recurrence_parent_id is not null;

create index if not exists idx_transactions_recurring_active
  on public.transactions(is_recurring, date)
  where is_recurring = true and recurrence_parent_id is null;

-- Helper: compute next occurrence date based on type
create or replace function public.next_recurrence_date(
  _last_date date,
  _type text,
  _anchor_day integer default null
) returns date
language plpgsql
immutable
as $$
declare
  next_d date;
begin
  if _type = 'weekly' then
    next_d := _last_date + interval '7 days';
  elsif _type = 'monthly' then
    next_d := _last_date + interval '1 month';
    if _anchor_day is not null then
      -- Snap to anchor day, capped at month end
      next_d := least(
        date_trunc('month', next_d)::date + (_anchor_day - 1),
        (date_trunc('month', next_d) + interval '1 month - 1 day')::date
      );
    end if;
  elsif _type = 'yearly' then
    next_d := _last_date + interval '1 year';
  else
    next_d := null;
  end if;
  return next_d;
end;
$$;

commit;
