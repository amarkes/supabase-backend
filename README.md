# Supabase Backend Project

Este projeto contém o backend completo usando Supabase, incluindo migrations do banco de dados e Edge Functions.

## Estrutura do Projeto

```
supabase/
├── migrations/           # Migrations do banco de dados
│   ├── 20240901000000_create_users_table.sql
│   └── 20240901000001_create_user_trigger.sql
├── functions/            # Edge Functions
│   └── users/           # Função para gerenciar usuários
│       ├── index.ts     # Código da Edge Function
│       └── deno.json    # Configuração Deno
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

## Edge Functions

### Users Function (`/functions/users`)
- **GET**: Buscar perfil do usuário autenticado
- **POST**: Criar/atualizar perfil do usuário
- **PUT**: Atualizar perfil existente

#### Endpoints:
- `GET /functions/v1/users` - Buscar perfil
- `POST /functions/v1/users` - Criar/atualizar perfil
- `PUT /functions/v1/users` - Atualizar perfil

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
supabase functions deploy users

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
