# Arquitetura (Fases 1–4)

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

## Fase 2: texto → formatos
- **Processamento no navegador.** O Worker Free tem 10 ms de CPU; leitura de arquivos (mammoth/unpdf, carregados sob demanda), análise e geração rodam no cliente (`packages/shared/src/text`, funções puras e determinísticas, com testes). O servidor valida, persiste e isola por tenant.
- **Motor de texto:** idioma (`franc-min`: por/eng/spa), palavras-chave (implementação própria *inspirada* em YAKE, rotulada `yake-inspired@1`, sem alegar equivalência), resumo extrativo (TextRank sobre similaridade de cosseno TF-IDF, `textrank-tfidf@1`). Stopwords em pt/en/es.
- **Templates:** placeholders `{{titulo}}`, `{{trecho}}`, `{{keywords}}`, `{{cta}}` (mais `{{resumo}}`), catálogo pt/en conforme o idioma detectado; 7 tipos: título, descrição, legenda, roteiro, artigo, newsletter, post. Toda saída é `source_kind='template'`, definido pelo servidor.
- **Fluxo de dados:** `PUT .../source` (texto + análise) → `POST .../outputs` (lote) → `PATCH .../outputs/:id` (bloqueio otimista por `version`) → `GET .../export-data` (conta a quota mensal) → serialização local. Detalhes do formato em `docs/export.md`.

## Fase 3: transcrição
- Pipeline de `processing_jobs` com estados persistidos (colada/SRT/VTT e WASM); o Worker só orquestra estados e valida, nunca processa mídia. Revisão humana antes de gravar. Detalhes e limites em `docs/transcription.md`.
- Parser SRT/VTT próprio e sem dependências em `packages/shared` (usado pelo cliente e pelas regras de validação do servidor); serializadores SRT/VTT prontos para a Fase 4.
- Modo WASM isolado em `apps/web/src/lib/wasm.ts` (import dinâmico; fora do cache de instalação do PWA). Lógica de bloqueio é função pura testada.

## Fase 4: transformação
- Heurística de cortes (`transcript/clips.ts`) e templates por canal (`text/channels.ts`) são funções puras em `packages/shared`, rodando no navegador; o servidor só valida e persiste (cortes com `version`, saídas forçadas a `template`). Detalhes em `docs/clips.md` e `docs/export.md`.
- A exportação ganhou SRT/VTT (da transcrição com timestamps) e `clips`/`transcript` no JSON, sem mudar o `schemaVersion`.

## Fase 6: equipes, calendário e compartilhamento
- Novas rotas em `apps/api/src/routes/{team,editorial,sharing}.ts`, registradas por `workspaces.ts`; `/api/invites` e `/api/shared` ficam fora do escopo de workspace (a segunda é pública, sem sessão, com rate limit e cabeçalhos `noindex`/`no-referrer`).
- Tokens (convite e link) são aleatórios, mostrados uma vez e guardados só como SHA-256. Aprovações guardam a versão do output; calendário usa datas sem horário. Detalhes em `docs/team-calendar.md`.
- Front: `@dnd-kit/core` apenas no calendário; página pública `/s/:token` renderizada fora do Layout.
