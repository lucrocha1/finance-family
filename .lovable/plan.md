## Objetivo desta entrega

Implementar **somente** a base de autenticação do app **Finance Family** com visual dark premium consistente, usando **Supabase Auth (conexão Supabase)** — **não Lovable Cloud**.

Inclui apenas:

- Login
- Cadastro
- Proteção de rotas
- Dashboard placeholder
- Design system base

Sem sidebar, sem header, sem sistema de família nesta etapa.

## Escopo funcional

### 1) Design system base (dark premium)

Padronizar tokens visuais globais e aplicar em todas as telas desta fase:

- Background principal, cards, inputs
- Bordas, foco, textos
- Accent/hover, sucesso, erro
- Inter + fallback
- Border radius (cards e campos/botões)
- Transições (`transition-all duration-200`) em elementos interativos

### 2) Rotas e navegação

Estruturar as rotas:

- `/login`
- `/register`
- `/dashboard` (placeholder protegido)

Regras:

- Usuário autenticado em `/login` ou `/register` → redirecionar para `/dashboard`
- Usuário não autenticado em `/dashboard` → redirecionar para `/login`

### 3) Integração com Supabase (externo)

Configurar autenticação com **Supabase Auth**:

- Cliente Supabase no frontend
- `AuthProvider` com sessão/usuário/loading
- `getSession()` no mount
- `onAuthStateChange()` para sincronização em tempo real

### 4) Tela de Login (`/login`)

Layout centralizado premium:

- Título: **💰 Finance Family**
- Subtítulo: “Gerencie suas finanças em família”
- Campo email
- Campo senha com toggle de visibilidade
- Botão “Entrar” full width
- Link para cadastro
- Mensagem de erro inline (sem alert)

Ação:

- `supabase.auth.signInWithPassword({ email, password })`
- Sucesso: redireciona para `/dashboard`

### 5) Tela de Cadastro (`/register`)

Mesmo visual do login, com campos:

- Nome completo
- Email
- Senha
- Confirmar senha
- Toggle de visibilidade nas senhas

Validações inline:

- Nome obrigatório
- Email válido
- Senha com mínimo de 6 caracteres
- Confirmação igual à senha

Ação:

- `supabase.auth.signUp({ email, password, options: { data: { full_name: nome } } })`
- Comportamento definido: **entrar direto após cadastro**
- Sucesso: redireciona para `/dashboard`
- Erro: mostrar na tela

**6) Perfil de usuário**   
A tabela `profiles` JÁ EXISTE no Supabase com um trigger que cria o perfil automaticamente ao fazer signup. O frontend NÃO deve criar tabelas — apenas LER o profile após login: `supabase.from('profiles').select('*').eq('id', user.id).single()`. O campo `full_name` já é salvo pelo trigger a partir do `raw_user_meta_data`.

### 7) ProtectedRoute

Componente de proteção:

- `loading` → spinner centralizado (accent)
- Sem sessão → redirect `/login`
- Com sessão → renderiza children

### 8) Dashboard placeholder (`/dashboard`)

Página protegida mínima para validação do fluxo:

- Texto central: **“Dashboard — Em breve”**
- Estilo alinhado ao tema

## Critérios de aceite

- Rotas `/login`, `/register`, `/dashboard` funcionando
- Login autentica e redireciona corretamente
- Cadastro valida, cria usuário, salva nome e redireciona
- Dashboard bloqueado para não autenticados
- Telas de auth bloqueadas para autenticados
- Visual segue 100% do dark premium definido
- Nenhuma funcionalidade extra além do solicitado