-- Tags em transações: array de strings pra agrupar lançamentos
-- transversalmente às categorias (ex: "Trabalho", "Aniversário 2026",
-- "Reembolso pendente"). Não substitui categoria — é orthogonal.

begin;

alter table public.transactions
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists idx_transactions_tags
  on public.transactions using gin(tags);

commit;
