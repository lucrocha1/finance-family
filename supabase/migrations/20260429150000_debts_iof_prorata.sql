-- Add IOF field to debts and document pro-rata interest calculation.
-- Pro-rata applies to single-payment loans (à vista) using actual days
-- between start_date and due_date. Installment loans keep monthly
-- compounding since each parcel accrues differently.

begin;

alter table public.debts
  add column if not exists iof_amount numeric(12, 2) default 0;

comment on column public.debts.iof_amount is 'IOF (Brazilian financial transaction tax) charged on the loan';
comment on column public.debts.total_with_interest is 'Final amount: principal + pro-rata interest (single-payment) or compounded interest (installments) + IOF';

commit;
