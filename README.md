# LUNEFLIX

Seu cinema. Sua noite.

Aplicação web de catálogo de filmes e séries com autenticação, painel administrativo, reprodução por provedor externo e persistência local/Supabase.

## Requisitos

- Node.js 18 ou superior
- Python 3.10 ou superior
- Uma conta TMDB e um token de API
- Supabase configurado para persistir sessões em produção

## Instalação local

Na raiz do projeto:

```powershell
npm install
Copy-Item back/.env.example back/.env
```

Edite `back/.env` e informe pelo menos `TMDB_API_TOKEN`. Depois inicie o servidor:

```powershell
npm start
```

A aplicação ficará disponível em `http://localhost:3000`.

## Variáveis de ambiente

O arquivo `back/.env.example` contém o modelo:

```env
PORT=3000
VIDEO_PROVIDER=embedmovies
TMDB_API_URL=https://api.themoviedb.org/3
TMDB_API_TOKEN=seu_token_tmdb
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_chave_privada
NODE_ENV=development
FRONTEND_URL=https://seu-projeto.vercel.app
```

`SUPABASE_SERVICE_ROLE_KEY` é uma chave privada. Ela deve existir somente no backend, nunca no frontend ou no repositório.

## Pagamentos PIX (CashinPay)

O backend cria cobranças PIX na CashinPay e valida o webhook assinado; `CASHINPAY_API_KEY` e `CASHINPAY_WEBHOOK_SECRET` devem ficar somente nas variáveis do backend. Execute também `supabase/migrations/003_cashinpay_payments.sql` no SQL Editor do Supabase antes do deploy.

No painel CashinPay, configure o webhook HTTPS para `https://SEU_BACKEND/api/webhooks/cashinpay` e informe o mesmo segredo em `CASHINPAY_WEBHOOK_SECRET`. Para desenvolvimento local, exponha o servidor com `ngrok http 3000` e use a URL HTTPS fornecida pelo ngrok. Use uma chave `sk_test_` no ambiente de testes; nunca teste cobranças reais com uma chave live.

Em produção, `FRONTEND_URL` deve ser a origem exata da Vercel, sem barra final. No frontend, coloque a URL pública do Railway em `frontend/front/javascript/config.js`. Como o frontend é estático, essa URL é configurada no arquivo antes do deploy.

## Supabase e sessões

Em produção, as sessões são gravadas na tabela `sessions` do Supabase. Execute `supabase/migrations/001_sessions.sql` e `supabase/migrations/002_app_schema.sql` no SQL Editor do projeto.

Depois configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente onde o backend Node será executado. O servidor salva somente o hash do token e a data de expiração; o token original fica no cookie `HttpOnly` do navegador.

Sem essas variáveis, o sistema usa memória apenas para desenvolvimento. Nesse modo, as sessões são perdidas quando o servidor reinicia.

Para enviar os dados existentes do SQLite para o Supabase, configure as variáveis no ambiente e execute na raiz:

```powershell
$env:SUPABASE_URL="https://seu-projeto.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="sua_chave_privada"
python back/migrate-sqlite-to-supabase.py
```

O script envia usuários, catálogo, pagamentos, cupons, módulos, configurações e logs usando `upsert`. Ele não apaga o SQLite local. Faça um backup antes. Os controladores de produção usam o Supabase; o SQLite é necessário apenas enquanto você mantiver esse script de migração.

## Funcionalidades

- Cadastro e login com senha protegida por PBKDF2.
- Sessão HTTP com cookie `HttpOnly`, logout e proteção do player.
- Recuperação de senha com token de uso único e expiração de 30 minutos.
- Perfil com nome e avatar persistidos no backend.
- Catálogo de filmes e séries usando SQLite local e fallback para TMDB.
- Busca de títulos com cache local e controle de requisições externas.
- Modal responsivo com poster, sinopse, categorias, nota, classificação e ano.
- Temporadas e episódios de séries carregados sob demanda.
- Painel administrativo com usuários, catálogo, cupons, configurações e logs.
- Testes automatizados das rotas de sessão, player e recuperação.

## Rotas principais

| Método | Rota | Finalidade |
| --- | --- | --- |
| `POST` | `/api/register` | Criar conta |
| `POST` | `/api/login` | Entrar e criar sessão |
| `GET` | `/api/me` | Consultar sessão atual |
| `POST` | `/api/logout` | Encerrar sessão |
| `POST` | `/api/forgot-password` | Solicitar recuperação |
| `POST` | `/api/reset-password` | Definir nova senha |
| `GET` | `/api/filmes` | Listar filmes |
| `GET` | `/api/series` | Listar séries |
| `GET` | `/api/search?q=...` | Pesquisar catálogo |
| `GET` | `/api/player` | Gerar URL protegida de reprodução |
| `GET` | `/admin` | Abrir painel administrativo |

## Banco local e catálogo

O arquivo SQLite em `back/database/usuarios.sqlite` é apenas um backup local de migração. A aplicação em produção usa exclusivamente o Supabase; arquivos SQLite não devem ser versionados.

Para migrar filmes legados que possuem IMDb ID na URL:

```powershell
node back/migrate-catalog.js
```

Para visualizar o banco, use uma extensão SQLite no VS Code. Não abra o arquivo como texto.

## Recuperação de senha em desenvolvimento

O endpoint não revela se o e-mail existe. Em desenvolvimento, o link de recuperação é exibido no terminal do backend por 30 minutos. Em produção, substitua esse log por um serviço de e-mail transacional antes de disponibilizar a funcionalidade.

## Testes

Execute:

```powershell
npm test
```

Os testes iniciam um servidor temporário e verificam que sessões ausentes e reprodução sem autenticação são recusadas, além do comportamento da recuperação de senha.

## Deploy

1. Hospede o backend Node em um serviço com variáveis de ambiente e HTTPS.
2. Configure `PORT`, `TMDB_API_TOKEN`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. Execute `npm install` durante o build e `npm start` no comando de inicialização.
4. Execute as migrações SQL do Supabase e depois a migração do SQLite antes de testar login.
5. Use `NODE_ENV=production` para ativar cookies `Secure`.
6. Não publique `.env`, bancos SQLite, backups, logs ou chaves privadas.

O checkout e os webhooks da Infinity Pay ainda precisam ser integrados. Até essa etapa, pagamentos aprovados não são criados automaticamente e o acesso pago deve ser tratado como funcionalidade em desenvolvimento.

## Estrutura resumida

```text
back/                       Backend Express e controladores Python
back/models/                Modelo SQLite de usuários
back/services/              Catálogo e sessões Supabase
frontend/index.html         Entrada do frontend
frontend/front/pages/       Páginas HTML
frontend/front/javascript/  Comportamento das telas
frontend/front/css/         Estilos
supabase/migrations/        SQL de infraestrutura do Supabase
tests/                      Testes automatizados
```
