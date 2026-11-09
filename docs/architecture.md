# Arquitetura (Fase 1)

```
apps/web  (React + Vite + Tailwind, PWA)   ──build──►  apps/web/dist
apps/api  (Cloudflare Worker + Hono + Drizzle + D1)  ──serve──► /api/*  +  assets estáticos
packages/shared  (zod, constantes, derivação da chave de autenticação)
```

- **Um único Worker** serve a API (`/api/*`) e o frontend (assets estáticos com fallback de SPA). Mesma origem: cookies `SameSite=Lax` simples e CSRF por `Origin`. Consolida em 1 Worker (limite de 100 por conta, sem folga necessária).
- **Sem storage de arquivos** nesta fase. Texto vai direto ao D1. Mídia nunca passa pelo Worker (regra permanente).
- **Jobs:** Cron (horário hoje) mais tabela `processing_jobs`; Queues descartado (10 mil ops/dia, retenção de 24 h). Com 10 ms de CPU por execução, cada tick deve ser curto.
- **Rate limit:** D1 (KV tem 1.000 escritas/dia no Free).
- **Estado real na UI (R4):** `/api/config` informa se auth e Turnstile estão configurados; o frontend bloqueia e explica.
- **Limitações:** `apps/web/src/limitations/data.ts` é a fonte única; gera `docs/limitations.md` (CI falha se divergir) e alimenta o componente `<Limitation />`.
- **Testes:** Vitest (shared, API sobre D1 simulado com `node:sqlite`, web), Playwright (E2E com workerd local e Chrome; desktop e mobile).
