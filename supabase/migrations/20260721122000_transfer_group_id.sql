-- F13/F14/F16: liga as duas pernas de uma transferência por um id de grupo.
-- Antes, cada transferência criava 2 rows independentes (out/in) SEM nenhum
-- vínculo, então excluir/editar/marcar-como-paga mexia em só uma perna e
-- desbalanceava o saldo total do banco (a perna órfã continuava sendo somada
-- pelo trigger recompute_account_balance). Com transfer_group_id o frontend
-- passa a operar o par de forma atômica.
-- Coluna nullable; não há transferências existentes para backfill.
alter table public.transactions add column if not exists transfer_group_id uuid;

create index if not exists idx_transactions_transfer_group
  on public.transactions(transfer_group_id)
  where transfer_group_id is not null;
