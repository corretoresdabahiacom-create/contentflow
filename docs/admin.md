# Painel de administração global (Fase 7)

Rota `/app/admin` (API `/api/admin/*`). Quem não é admin global recebe **404** na API e é redirecionado na página.

## Regra de ouro: só metadados
O painel mostra contagens e identificadores abreviados. **Nunca** exibe texto-fonte, transcrições, corpo de outputs, brand kit, e-mail ou contato de quem denuncia, nem credenciais. A única amostra é o início (200 caracteres) de outputs de um link compartilhado **que foi denunciado** e já era público (docs/moderation.md). Testes automatizados verificam que `GET /overview`, `/jobs` e `/users` não vazam conteúdo (`apps/api/test/admin.test.ts`).

## Abas
| Aba | O que mostra / permite |
|---|---|
| Resumo | linhas por tabela do D1, jobs travados e com falha (7 dias), denúncias abertas, arquivos (só metadados; não há storage de arquivos), alertas de cota |
| Usuários | e-mail, status, nº de workspaces; suspender/reativar (não a si nem a outros admins; derruba a sessão) |
| Workspaces / Projetos | contagens (membros, clients, projetos, links ativos; arquivos, bytes, outputs) |
| Jobs | travados (>`job.stuck_after_s`, 1 h) e com falha; cancelar apaga o rascunho (payload) |
| Denúncias | fila de moderação (docs/moderation.md) |
| Flags | liga/desliga `video_render_enabled` e `wasm_transcription_enabled`. `monetization_enabled` (R7) e `ai_external_enabled` (R2) são **travadas** (409) |
| Cotas | edita chaves `quota.*`, `rate_limit.*`, `job.*`, `report.*`, `shared_link.*` (inteiros 1…10 000 000, só chaves existentes) e mostra o maior uso medido |
| Auditoria | últimos 100 eventos (ação, quem, alvo; sem metadados) |

## Consumo da Cloudflare (R4)
Requisições do Worker e leituras/escritas do D1 aparecem como **indisponível**: medir exigiria um token de API no servidor (não existe). R2 aparece como "não se aplica". Use Workers & D1 > Metrics no painel da Cloudflare. Consequência: o bloqueio automático em 90% do consumo **global** da §10 não é possível; o sistema avisa e limita apenas as cotas internas.

## Alertas de cota (70% e 90%)
O Cron horário compara o maior uso com o limite de cada cota medida (projetos, clients, membros, calendário, outputs e cortes) e cria um aviso in-app para cada admin global, sem duplicar enquanto não lido. A UI mostra o nível (`atenção ≥70%`, `crítico ≥90%`). Cotas sem medidor aparecem como "sem medidor".

## Como tornar alguém admin global
Não há tela nem rota (por desenho). Quem opera o banco executa, após a pessoa se cadastrar:

```
npx wrangler d1 execute contentflow --remote \
  --command "update users set is_global_admin = 1 where email = 'pessoa@exemplo.com'"
```
Revogar é o mesmo comando com `= 0`. Anote quem concedeu e quando em `docs/free-tier-limits.md` (assinaturas humanas).

## Publicar (deploy)
Plano Free, sem cartão. No seu computador, depois de `npx wrangler login`:

```
scripts/deploy.sh --check        # só verifica
scripts/deploy.sh --create-db    # cria o D1 e grava o database_id no wrangler.toml (faça commit)
TURNSTILE_SITE_KEY=0x4AAA... scripts/deploy.sh   # migra, publica e testa
```
O script recusa continuar se o `wrangler.toml` tiver recurso fora do plano gratuito (R1/R2), pede confirmação antes de publicar (R6), gera o `SESSION_PEPPER`, pede o `TURNSTILE_SECRET` sem ecoar e confere `/api/health`, o Turnstile e o 404 de `/billing` (R7).
