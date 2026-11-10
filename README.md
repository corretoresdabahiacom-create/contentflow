# ContentFlow AI

SaaS multi-tenant que transforma **um** conteúdo (texto ou transcrição) em **vários** formatos prontos para canais, com transparência sobre o que é processamento real e o que é sugestão por template. Custo zero: somente free tiers, sem cartão.

> Estado: **Fase 5 (plano de edição; vídeo não renderizado)**. Além da Fase 4 (abaixo), cada corte pode ser exportado como **plano de edição** (TXT, MD, CSV, JSON: IN/OUT, roteiro e notas; `docs/edit-plan.md`). O corte de vídeo no navegador **não está habilitado**: o teste de viabilidade do ffmpeg.wasm não foi executado (`blocked`, `docs/video-viability.md`).
>
> Fase 4 (transformação): Sobre as Fases 1–3 (conta, multi-tenant, projetos, análise de texto, transcrição por colagem/SRT/VTT/WASM opcional), agora há **sugestões de corte por heurística textual** (com justificativa visível, edição manual e versão), **saídas por template para YouTube, Instagram, TikTok, LinkedIn, Facebook, Blog e E-mail** (rotuladas `template`, limites de caracteres aproximados) e exportação em **TXT, MD, SRT, VTT, CSV e JSON** (`docs/export.md`, `docs/clips.md`). O produto não analisa emoção nem viralidade e não renderiza vídeo. Calendário, equipes e administração chegam nas próximas fases. Veja `docs/limitations.md` para o que **não** fazemos.

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
