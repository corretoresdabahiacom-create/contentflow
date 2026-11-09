# ContentFlow AI

SaaS multi-tenant que transforma **um** conteúdo (texto ou transcrição) em **vários** formatos prontos para canais, com transparência sobre o que é processamento real e o que é sugestão por template. Custo zero: somente free tiers, sem cartão.

> Estado: **Fase 1 (fundação)**. Existem cadastro/login, workspace pessoal, isolamento multi-tenant, i18n EN/PT, PWA instalável e a página de limitações. Projetos, textos, transcrição, cortes, calendário e administração chegam nas próximas fases. Veja `docs/limitations.md` para o que o produto **não** faz.

## Estrutura
- `apps/web`: React + Vite + Tailwind (PWA)
- `apps/api`: Cloudflare Worker + Hono + Drizzle + D1 (serve também o frontend)
- `packages/shared`: schemas zod, constantes, derivação da chave de autenticação
- `docs/`: arquitetura, modelo de dados, segurança, limites de free tier, limitações, variáveis

## Desenvolvimento
```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm check:limitations && pnpm test   # qualidade
pnpm --filter @contentflow/web build && npx playwright test          # E2E (usa o Chrome do sistema)
```
Local: crie `apps/api/.dev.vars` com `SESSION_PEPPER` (≥ 32 caracteres) e `ENVIRONMENT=development`; `pnpm --filter @contentflow/api dev` após `wrangler d1 migrations apply contentflow --local`. Detalhes em `docs/env-vars.md`.

## Deploy
Bloqueado até: criar o D1 e preencher `database_id` em `apps/api/wrangler.toml`; definir `SESSION_PEPPER`, `TURNSTILE_SECRET` e `TURNSTILE_SITE_KEY`; revisar `docs/free-tier-limits.md`. Nada é cobrado nos free tiers listados; não configure cartão na conta Cloudflare.

## Regras do projeto
Sem serviços pagos nem cartão; sem segredos no frontend; a UI reflete o estado real (`não configurado`, `indisponível`); sem dados simulados como reais; sem rotas de cobrança.
