# Limites de free tier — ContentFlow AI

| Campo | Valor |
|---|---|
| Versão do documento | 0.2.0 |
| Última verificação | 2026-11-09 |
| Verificado por | Claude (Fase 0); assinatura humana pendente: @____ |
| Próxima revisão obrigatória | 2027-02-07 (+90 dias) |
| Status | **verified** para o escopo de texto da Fase 1 (R2 excluído) |

Regra: nenhum recurso é usado sem fonte e data nesta tabela. Valores abaixo foram lidos das páginas oficiais da Cloudflare/GitHub em 2026-11-09.

## Decisões aprovadas em 2026-11-09

1. **R2 excluído.** Suspeita de exigir cartão (não confirmada em fonte oficial); R1 proíbe cartão. Fases 1, 2 e 4 operam só com texto, lido no navegador; apenas o texto vai ao D1. Upload de áudio (Fase 3) fica suspenso até um storage sem cartão ser verificado em fonte oficial.
2. **Senha:** com 10 ms de CPU, a chave é derivada por PBKDF2 pesado no navegador (Web Crypto). O servidor guarda só um hash rápido dessa chave, com salt por usuário e pepper em secret. **Hipótese a medir na Fase 1**; resultado em `docs/security.md`.
3. **Rate limit:** sem KV (1.000 escritas/dia). Turnstile mais contadores em D1 por janela, limites em `system_settings`.
4. **Fila de jobs:** Cron (1 min) mais `processing_jobs`. Queues descartado (10 mil ops/dia, retenção de 24 h).
5. **Fase 2 (2026-11-09):** nenhum serviço novo. Dependências de navegador gratuitas e sem rede (`franc-min`, `mammoth`, `unpdf`). Orçamento de escritas D1: criar saídas é 1 `batch` (conta como 1 consulta); cada edição = 1 escrita; cada exportação = 1 escrita em `usage_records` mais 1 em `audit_logs`. Quotas novas: 200 saídas por projeto e 500 exportações por mês por workspace.
6. **Fase 3 (2026-11-09):** sem serviço novo no servidor. O modelo Whisper (Hugging Face, público, sem conta nem cartão) é baixado pelo navegador do usuário; o custo de banda e computação é do usuário e o modo é opcional. Orçamento de escritas D1: cada segmento = 1 escrita (máx. 1.000 por transcrição); aprovar uma transcrição cheia ≈ 1.010 escritas, portanto ≈ 100 transcrições completas/dia consomem todo o orçamento diário de escritas. Quota de 200 transcrições/mês por workspace; com muitos tenants a quota global diária do D1 é o limite real (documentado, não contornado).
7. **Fase 4 (2026-11-10):** nenhum serviço novo e nenhuma dependência nova. Cada corte salvo é 1 escrita no D1 (máx. 100 por projeto; criação em lote conta como 1 consulta); editar = 1 escrita; regenerar = 1 delete + N inserts. Saídas por canal reutilizam a quota de 200 saídas por projeto.
8. **Fase 6 (2026-11-10):** nenhum serviço novo e nenhum e-mail. Dependência de navegador nova, gratuita e sem rede: `@dnd-kit/core` (previsto no §5.2 do briefing). Escritas no D1: convite = 1 (aceite = 2); item de calendário = 1 por criação ou movimento (arrastar é 1 PATCH); pedido/decisão de aprovação = 1; link compartilhado = 1 batch; cada leitura pública faz 1 escrita de rate limit e, no máximo, 1 registro de acesso por visitante a cada 10 min. Quotas novas: 3 equipes por usuário, 500 itens de calendário e 50 links ativos por workspace; logs de acesso apagados após 90 dias. Um link viral pode consumir escritas de rate limit: o teto de 120 leituras/10 min por visitante limita, mas não elimina, esse risco (documentado).
9. **Quotas ativas:** limites do D1 (500 MB por banco, 2 MB por linha). Quotas de arquivo (5 GB, 200 MB) desativadas.

## 1. Cloudflare Workers (Free)

Fonte: https://developers.cloudflare.com/workers/platform/limits/ (acessado 2026-11-09)

| Item | Limite Free |
|---|---|
| Requisições/dia | 100.000 (reset 00:00 UTC); ao exceder, Error 1027 |
| CPU por requisição HTTP | **10 ms** |
| CPU por Cron Trigger | **10 ms** |
| Memória por isolate | 128 MB |
| Subrequests por invocação | 50 (internos: 1.000) |
| Conexões simultâneas de saída | 6 |
| Variáveis de ambiente por Worker | 64 (5 KB cada) |
| Tamanho do Worker | 64 MiB |
| Startup | 1 s |
| Workers por conta | 100 |
| Cron Triggers por conta | 5 |
| Body de request | 100 MB (depende do plano do domínio) |
| Assets estáticos | 20.000 arquivos, 25 MiB cada |

## 2. Cloudflare D1 (Free)

Fontes: https://developers.cloudflare.com/d1/platform/pricing/ e /d1/platform/limits/ (2026-11-09)

| Item | Limite Free |
|---|---|
| Linhas lidas/dia | 5.000.000 |
| Linhas escritas/dia | 100.000 |
| Storage total | 5 GB |
| Tamanho máx. por banco | 500 MB |
| Bancos por conta | 10 |
| Queries por invocação do Worker | 50 (`db.batch()` conta como 1) |
| Tamanho máx. de linha/string/BLOB | 2 MB |
| Tamanho máx. de SQL | 100 KB |
| Parâmetros por query | 100 |
| Duração máx. de query | 30 s |

Ao exceder leitura/escrita diária, queries retornam erro. Não gera cobrança no Free.

## 3. Cloudflare R2

Fonte: https://developers.cloudflare.com/r2/pricing/ (2026-11-09)

| Item | Free (somente Standard) |
|---|---|
| Storage | 10 GB-mês |
| Class A | 1 milhão/mês |
| Class B | 10 milhões/mês |
| Egress | gratuito |

**Status: BLOQUEADO** (ver "Bloqueios" nº 1). Valores de quota são conhecidos, mas a ativação sem cartão não está confirmada. Observação: o free de 10 GB é menor que os 5 GB/workspace do briefing × N workspaces; o cap global deve ser ≤ 10 GB.

## 4. Cloudflare KV (Free)

Fonte: https://developers.cloudflare.com/kv/platform/limits (2026-11-09)

| Item | Limite Free |
|---|---|
| Leituras/dia | 100.000 |
| Escritas/dia (chaves diferentes) | **1.000** |
| Escritas/s na mesma chave | 1 |
| Tamanho de valor | 25 MiB |
| Tamanho de chave | 512 B |
| Namespaces | 1.000 |
| Operações por invocação | 1.000 |
| Deletes/dia, list/dia | não listados na página; tratar como indisponível/não confirmado |

Atenção: 1.000 escritas/dia torna rate limit por IP+usuário em KV inviável (cada tentativa é uma escrita). Revisar na Fase 1.

## 5. Cloudflare Queues

Fonte: https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/ (2026-11-09)

| Item | Free |
|---|---|
| Disponível? | **Sim** (desde 2026-02-04) |
| Operações/dia | 10.000 (leitura, escrita e delete) |
| Retenção máx. de mensagem | 24 h |
| Filas por conta | 10.000 |

Decisão pendente: Queues ou Cron + `processing_jobs`. Cron Triggers têm só 10 ms de CPU e 5 por conta.

## 6. Cloudflare Pages (Free)

Fonte: https://developers.cloudflare.com/pages/platform/limits/ (2026-11-09)

500 builds/mês, 1 build simultâneo, 20.000 arquivos/site, 25 MiB por arquivo, 100 projetos, 100 domínios custom por projeto.

## 7. Cloudflare Turnstile (Free)

Fonte: https://developers.cloudflare.com/turnstile/plans/ (2026-11-09)

Gratuito; 20 widgets por conta; verificações ilimitadas; 10 hostnames por widget; analytics 7 dias. Exigência de cartão no cadastro da conta Cloudflare: não informada na página, **não confirmado**.

## 8. Cron Triggers

Fonte: https://developers.cloudflare.com/workers/configuration/cron-triggers/ (2026-11-09)

Máx. 5 por conta, 10 ms de CPU por execução, granularidade mínima 1 minuto.

## 9. GitHub (Free)

Fonte: docs.github.com, "About billing for GitHub Actions" (2026-11-09)

Repositório privado: US$ 12/mês em compute incluído (~2.000 min Linux, estimativa nossa), 500 MB de artefatos, 10 GB de cache. Runners padrão são gratuitos em repositórios públicos.

## 10. Serviços proibidos nesta fase

Cloudflare Stream, Media Transformations, Images (transformação), STT de nuvem (Google/AWS), APIs de IA (OpenAI/Anthropic/Gemini/Mistral), AssemblyAI/Deepgram/Rev/Speechmatics, e-mail transacional, pagamentos, Sentry/Datadog/GA com payload, qualquer serviço que exija cartão.

Assinaturas pendentes: verificado por @____ em ____-__-__.
