# Validação da Fase 7 (2026-11-10)

Tudo roda localmente, sem custo. Resultados abaixo são do ambiente de desenvolvimento; não substituem medir em produção.

## Testes
| Camada | Resultado |
|---|---|
| shared (vitest) | 79 testes |
| web (vitest) | 23 testes |
| api (vitest, inclui admin, segurança, isolamento) | 84 testes |
| E2E (Playwright, Chrome do sistema, desktop + Pixel 7) | ver contagem no relatório da fase |

## Lighthouse CI (`pnpm lighthouse`, `lighthouserc.json`, Lighthouse 13.6, perfil móvel)
| Página | Performance | Acessibilidade | Boas práticas | SEO |
|---|---|---|---|---|
| `/` | 97 | 100 | 92 | 91 |
| `/login` | 91 | 96 | 92 | 91 |
| `/report` | 98 | 100 | 92 | 91 |
| `/docs/limitations` | 99 | 98 | 92 | 91 |

Limiar configurado: ≥ 90 nas quatro categorias (o CI falha abaixo disso).

**PWA ≥ 90 (briefing):** o Lighthouse 13 **removeu a categoria PWA**, então esse número não existe mais. Em troca verificamos o que ela verificava com um teste próprio (`e2e/app.spec.ts`, "PWA: manifest válido, service worker ativo e shell offline"): manifest com nome, `start_url`, `display: standalone`, ícones 192/512/maskable; service worker controlando a página; e o shell abre offline com aviso. Isso é equivalente em substância, não em nota.

## Carga local (`pnpm loadtest`, autocannon, 10 conexões, 8 s por rota, workerd local)
| Rota | req/s | p50 | p97,5 | p99 | 5xx |
|---|---|---|---|---|---|
| `/api/health` | 561 | 16 ms | 31 ms | 34 ms | 0 |
| `/api/config` (1 leitura D1) | 403 | 23 ms | 45 ms | 50 ms | 0 |
| `/` (estático) | 580 | 14 ms | 49 ms | 60 ms | 0 |
| `/api/shared/<inválido>` (1 escrita D1 de rate limit) | 334 | 27 ms | 59 ms | 77 ms | 0 |
| `/api/auth/me` sem sessão | 605 | 14 ms | 49 ms | 66 ms | 0 |

Sem erros 5xx, de conexão ou timeout. Em `/api/shared/*` as respostas passam a 429 depois de 120 requisições por visitante em 10 minutos: é o rate limit funcionando sob carga (e protege o orçamento de escritas do D1).

**Limites desta medição:** o local não tem os 10 ms de CPU do plano Free, nem rede real, nem as latências do D1 de produção. Escritas D1 por requisição seguem o orçamento de `docs/free-tier-limits.md`; não rodamos k6 (não instalado; o briefing aceita autocannon).

## Revisão de segurança
Ver `docs/security-review.md`.

## Ainda não validado
- Whisper/WASM de ponta a ponta em máquina real e o ffmpeg.wasm (Fase 5, `blocked`).
- Deploy real (falta `database_id` do D1 e secrets) e, portanto, Turnstile real, cabeçalhos servidos pela Cloudflare e métricas de produção.
