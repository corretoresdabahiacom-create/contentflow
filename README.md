# ContentFlow AI

SaaS multi-tenant que transforma **um** conteúdo (texto ou transcrição) em **vários** formatos prontos para canais, com transparência sobre o que é processamento real e o que é sugestão por template. Custo zero: somente free tiers, sem cartão.

> Estado: **Fase 3 (áudio e transcrição)**. Sobre as Fases 1–2 (conta, multi-tenant, projetos, análise de texto, saídas por template, exportação), agora há transcrição por **colagem**, **importação de .srt/.vtt** e **WASM opcional no navegador** (experimental, bloqueado em mobile por padrão), com jobs de estados persistidos, revisão humana antes de salvar e player de áudio **local** (o áudio nunca é enviado; R2 segue excluído). Detalhes e a verificação pendente do WASM em `docs/transcription.md`. Cortes, calendário e administração chegam nas próximas fases. Veja `docs/limitations.md` para o que o produto **não** faz.

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
