# Supabase Backend Project

Este projeto contém o backend completo usando Supabase, incluindo migrations do banco de dados e Edge Functions.

## Estrutura do Projeto

```
supabase/
├── migrations/           # Migrations do banco de dados
│   ├── 20240901000000_create_users_table.sql
│   ├── 20240901000001_create_user_trigger.sql
│   ├── 20240901000002_add_staff_field.sql
│   ├── 20240901000003_fix_user_registration_policy.sql
│   ├── 20240901000004_fix_users_policy_recursion.sql
│   └── 20240901000005_create_cashflow_tables.sql
├── functions/            # Edge Functions
│   ├── auth/            # Função de autenticação
│   │   ├── index.ts
│   │   └── deno.json
│   ├── users/           # Função para gerenciar usuários
│   │   ├── index.ts
│   │   └── deno.json
│   └── cashflow/        # Função de controle de caixa
│       ├── index.ts
│       └── deno.json
└── config.toml          # Configuração do Supabase
```

## Opções de Configuração

### Opção 1: Supabase Cloud (Recomendado - Gratuito)
Use o Supabase Cloud que oferece um plano gratuito com:
- 500MB de banco de dados
- 2GB de transferência
- 50MB de armazenamento
- Edge Functions incluídas

### Opção 2: Projeto Remoto Existente
Conecte-se a um projeto Supabase já existente

### Opção 3: Supabase Local (Requere Docker)
Para desenvolvimento local com Docker

## Configuração

### 1. Instalar Supabase CLI

**Via NPM (localmente no projeto)**
```bash
npm install supabase --save-dev
```

**Via Homebrew (macOS/Linux)**
```bash
brew install supabase/tap/supabase
```

### 2. Configurar Projeto Remoto

#### Criar novo projeto no Supabase Cloud:
1. Acesse [supabase.com](https://supabase.com)
2. Faça login e crie um novo projeto
3. Anote as credenciais (URL e chaves)

#### Ou conectar a projeto existente:
```bash
# Login no Supabase
npx supabase login

# Linkar projeto existente
npx supabase link --project-ref SEU_PROJECT_REF
```

### 3. Aplicar as Migrations
```bash
# Para projeto remoto
npx supabase db push

# Para projeto local (se tiver Docker)
npx supabase start
npx supabase db push
```

### 4. Deploy das Edge Functions
```bash
# Deploy para produção
npx supabase functions deploy users

# Testar localmente (se tiver Docker)
npx supabase functions serve
```

## Migrations

### Tabela Users
- Armazena dados adicionais do perfil do usuário
- Integra com Supabase Auth através de foreign key
- Inclui RLS (Row Level Security) para segurança
- Trigger automático para sincronizar com auth.users

### Trigger de Usuário
- Cria automaticamente perfil na tabela `users` quando usuário se registra
- Sincroniza dados básicos (id, email, full_name)

### Tabelas Cashflow
- **`categories`**: Categorias personalizáveis para receitas e despesas
- **`transactions`**: Transações financeiras com tags, notas e categorias
- **RLS**: Cada usuário vê apenas seus próprios dados
- **Categorias padrão**: Inclui categorias pré-definidas (Salário, Alimentação, etc.)

## Edge Functions

### Auth Function (`/functions/auth`)
- **GET /me**: Obter dados do usuário logado (dados de auth + perfil completo)
- **POST /login**: Login com email e senha

#### Endpoints:
- `GET /functions/v1/auth/me` - Dados do usuário logado
- `POST /functions/v1/auth/login` - Login do usuário

#### Exemplo de uso:
```bash
# Login
curl -X POST 'https://seu-projeto.supabase.co/functions/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email": "user@example.com", "password": "password"}'

# Obter dados do usuário
curl -X GET 'https://seu-projeto.supabase.co/functions/v1/auth/me' \
  -H 'Authorization: Bearer SEU_TOKEN'
```

### Users Function (`/functions/users`)
- **GET**: Buscar perfil do usuário autenticado
- **POST**: Criar/atualizar perfil do usuário
- **PUT**: Atualizar perfil existente

#### Endpoints:
- `GET /functions/v1/users` - Buscar perfil
- `POST /functions/v1/users` - Criar/atualizar perfil
- `PUT /functions/v1/users` - Atualizar perfil

### Cashflow Function (`/functions/cashflow`)
Sistema de controle de caixa pessoal para gerenciar receitas e despesas do dia a dia.

#### Funcionalidades:
- **Categorias**: Criar e gerenciar categorias personalizadas
- **Transações**: Registrar receitas e despesas
- **Resumo**: Visualizar balanço financeiro
- **Filtros**: Buscar transações por data, tipo, categoria

#### Endpoints:
- `GET /functions/v1/cashflow/categories` - Listar categorias
- `POST /functions/v1/cashflow/categories` - Criar categoria
- `GET /functions/v1/cashflow/transactions` - Listar transações
- `POST /functions/v1/cashflow/transactions` - Criar transação
- `PUT /functions/v1/cashflow/transactions/:id` - Atualizar transação
- `DELETE /functions/v1/cashflow/transactions/:id` - Deletar transação
- `GET /functions/v1/cashflow/summary` - Resumo financeiro

#### Exemplo de uso:
```bash
# Criar categoria
curl -X POST 'https://seu-projeto.supabase.co/functions/v1/cashflow/categories' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name": "Salário", "type": "income", "color": "#10B981", "icon": "💼"}'

# Criar receita
curl -X POST 'https://seu-projeto.supabase.co/functions/v1/cashflow/transactions' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"type": "income", "amount": 5000, "description": "Salário mensal", "category_id": "uuid"}'

# Criar despesa
curl -X POST 'https://seu-projeto.supabase.co/functions/v1/cashflow/transactions' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"type": "expense", "amount": 200, "description": "Supermercado", "category_id": "uuid"}'

# Resumo financeiro
curl -X GET 'https://seu-projeto.supabase.co/functions/v1/cashflow/summary' \
  -H 'Authorization: Bearer SEU_TOKEN'
```

#### Exemplo de uso:


## Autenticação

O projeto usa Supabase Auth com:
- Login por email/senha
- Tabela `users` sincronizada automaticamente
- RLS (Row Level Security) configurado
- Políticas de acesso baseadas no usuário autenticado

## Desenvolvimento

### Comandos úteis:
```bash
# Status do projeto
supabase status

# Linkar projeto remoto
supabase link --project-ref SEU_PROJECT_REF

# Nova Edge Functions
supabase functions new FUNCTION

# Aplicar migrations
supabase db push

# Deploy das Edge Functions
supabase functions deploy auth
supabase functions deploy users
supabase functions deploy cashflow

# Reset do banco (apenas para projetos locais)
supabase db reset
```

### Variáveis de ambiente necessárias:
Crie um arquivo `.env.local` com:
```bash
SUPABASE_URL=sua_url_do_projeto
SUPABASE_ANON_KEY=sua_chave_anonima
SUPABASE_SERVICE_ROLE_KEY=sua_chave_de_servico
```

### Para projetos remotos:
1. **URL**: `https://seu-project-ref.supabase.co`
2. **Anon Key**: Chave pública para frontend
3. **Service Role Key**: Chave privada para operações admin (não exponha no frontend)

### Swagger

``` bash
npm run swagger:serve
```



## Vantagens do Supabase Cloud:
- ✅ Sem necessidade de Docker
- ✅ Sem configuração local complexa
- ✅ Backup automático
- ✅ Escalabilidade automática
- ✅ Interface web para gerenciar dados
- ✅ Plano gratuito generoso
