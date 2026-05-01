-- Defesa em profundidade contra recorrentes duplicadas.
--
-- Antes desta migration: dois processos concorrentes (e.g., navegação
-- rápida + StrictMode dev, ou múltiplas abas, ou o gerador linked RPC
-- chamado por ambos os lados do par) podiam computar o mesmo max(date)
-- e inserir as MESMAS filhas duas vezes.
--
-- Frontend agora deduplica via Promise cache (useEnsureRecurrencesUpTo),
-- mas o banco enforça também: cada (recurrence_parent_id, date) só pode
-- ter UMA linha. Filhas duplicadas viram erro de constraint que o
-- generateRecurrencesForFamily silencia (não conta como criada).
--
-- Antes de criar o índice, deduplicamos linhas existentes mantendo a
-- mais antiga (created_at ascendente).

-- 1) Remove duplicatas existentes mantendo a primeira por
-- (recurrence_parent_id, date). Cuidado: só toca em filhas
-- (recurrence_parent_id IS NOT NULL).
with duplicates as (
  select id,
         row_number() over (
           partition by recurrence_parent_id, date
           order by created_at asc, id asc
         ) as rn
  from public.transactions
  where recurrence_parent_id is not null
)
delete from public.transactions
where id in (select id from duplicates where rn > 1);

-- 2) Cria índice único parcial: vale apenas pra filhas de recorrência.
-- Transações não-recorrentes (recurrence_parent_id IS NULL) não são
-- restringidas — usuário pode ter múltiplas compras na mesma data.
create unique index if not exists transactions_recurrence_parent_date_uniq
  on public.transactions (recurrence_parent_id, date)
  where recurrence_parent_id is not null;
