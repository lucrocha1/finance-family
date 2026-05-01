-- Cleanup do bug de off-by-one em recurrence_day. O frontend usava
-- new Date('YYYY-MM-DD').getDate() que é interpretado como UTC, retornando
-- o dia anterior em fusos a oeste (GMT-3 do Brasil). Resultado: parents
-- mensais com recurrence_day = day(date) - 1, e children gerados com
-- date um dia antes do esperado.
--
-- Esta migration corrige:
--   1) recurrence_day dos parents existentes pra bater com extract(day from date)
--   2) children pendentes cuja date ficou off-by-one
--
-- Children já com status='paid' não são alterados pra preservar histórico.

update public.transactions
set recurrence_day = extract(day from date)::int
where is_recurring = true
  and recurrence_type = 'monthly'
  and recurrence_day is not null
  and recurrence_day <> extract(day from date)::int;

update public.transactions c
set date = make_date(
  extract(year from c.date)::int,
  extract(month from c.date)::int,
  extract(day from p.date)::int
)
from public.transactions p
where c.recurrence_parent_id = p.id
  and p.recurrence_type = 'monthly'
  and c.status = 'pending'
  and extract(day from c.date)::int <> extract(day from p.date)::int
  and extract(day from p.date)::int <= extract(day from (date_trunc('month', c.date) + interval '1 month - 1 day'))::int;
