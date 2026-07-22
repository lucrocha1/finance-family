# Finance Family — Gestão Financeira Familiar

## O que é
App de gestão financeira pessoal e familiar. Dark theme premium. Multi-user com sistema de família (agrupamento organizacional). IMPORTANTE: os dados financeiros são isolados **por usuário** (RLS `user_id = auth.uid()`), NÃO compartilhados entre membros da família. A família serve pra vincular perfis (nome/e-mail visíveis entre membros), não pra compartilhar transações/contas/dívidas/etc.

## Stack
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Supabase (PostgreSQL + Auth + RLS)
- Charts: Recharts
- Ícones: Lucide React
- Routing: React Router

## Comandos
- `npm run dev` — rodar local
- `npm run build` — build de produção
- `npm run lint` — lint

## Supabase
- Auth: email/senha via supabase.auth
- RLS: tabelas financeiras isolam **por usuário** (`user_id = auth.uid()`). As tabelas de família (families, family_members, profiles) usam helpers SECURITY DEFINER (`is_family_member`/`is_family_admin`).
- Entrada em família só via RPCs SECURITY DEFINER `create_family` (dono → admin) e `join_family` (valida invite_code → member). Não há INSERT direto em family_members.
- Variáveis: VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env

## Arquitetura
- `src/contexts/AuthProvider.tsx` — contexto de autenticação (user, session)
- `src/contexts/FamilyProvider.tsx` — contexto de família (family, members, isAdmin)
- `src/components/layout/` — Sidebar, Header, ProtectedRoute
- `src/pages/` — uma página por rota
- `src/lib/supabase.ts` — cliente Supabase

## Design System
- Background principal: #0a0a0f
- Background cards: #12121a
- Background inputs: #1a1a24
- Borders: #1e1e2e
- Accent/Primary: #06b6d4 (ciano)
- Accent hover: #0891b2
- Success: #22c55e
- Danger: #ef4444
- Warning: #eab308
- Font: Inter

## Tabelas no Supabase
profiles, families, family_members, categories, accounts, cards, transactions, scheduled_payments, debts, debt_payments, investments, budgets, goals, goal_contributions, csv_imports

## Regras importantes
- Isolamento é por usuário: a RLS restringe cada query ao próprio `user_id`. Inserts gravam `user_id = auth.uid()` (e `family_id` por consistência), mas NÃO dependa de filtrar `family_id` no client pra segurança.
- RLS no banco cuida da segurança — o frontend passa user_id e family_id nos inserts
- Formato monetário: R$ brasileiro (1.000,00)
- Formato data: DD/MM/AAAA
