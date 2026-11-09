# Variáveis e segredos

| Nome | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `SESSION_PEPPER` | secret | sim | ≥ 32 caracteres aleatórios. `wrangler secret put SESSION_PEPPER`. Sem ele, auth responde 503. Trocar invalida todas as senhas. |
| `TURNSTILE_SECRET` | secret | sim em produção | Sem ele, cadastro/login ficam bloqueados (falha fechada). |
| `TURNSTILE_SITE_KEY` | var | sim em produção | Chave pública do widget; exposta por `/api/config`. |
| `ENVIRONMENT` | var | não | `production` (padrão no `wrangler.toml`) ou `development` (bypass explícito do Turnstile). Nunca usar `development` em produção. |
| `ALLOWED_ORIGINS` | var | não | Origens extras (vírgula) aceitas em métodos não idempotentes. |
| `DB` | binding D1 | sim | `database_id` em `apps/api/wrangler.toml` está como placeholder até `wrangler d1 create contentflow`. |

Desenvolvimento local: `apps/api/.dev.vars` (ignorado pelo git) com `SESSION_PEPPER` e `ENVIRONMENT=development`. Nenhum segredo vai para o frontend nem para o repositório.
