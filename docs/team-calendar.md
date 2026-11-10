# Equipes, calendário e compartilhamento (Fase 6)

Tudo isto roda no mesmo Worker e no D1, sem serviço novo, sem e-mail e sem custo (R1/R2). Migração `0005_team_calendar.sql`.

## Equipe e papéis

Workspace **pessoal** (criado no cadastro) tem só o dono. Um workspace **de equipe** (`kind = agency`) é criado no painel (`POST /api/workspaces`, máx. 3 por usuário como owner) e é o único que aceita convites.

| Ação | member | admin | owner |
|---|---|---|---|
| Ver membros, clients, calendário, brand kit | sim | sim | sim |
| Criar/editar projetos, saídas, itens do calendário, pedir aprovação | sim | sim | sim |
| Criar clients, editar brand kit, compartilhar por link, decidir aprovações | não | sim | sim |
| Convidar `member`, remover `member` | não | sim | sim |
| Convidar `admin`, remover `admin`, mudar papéis | não | não | sim |
| Sair do workspace | sim | sim | não (owner não sai nem é removido) |

Remover um membro limpa o responsável (`assignee_user_id`) das pautas dele.

## Convites

`POST /api/workspaces/:ws/invites {role, expiresInDays 1..30}` devolve o link `/invite/<token>` **uma única vez**; no banco fica só o SHA-256 do token. O aceite exige login (`POST /api/invites/:token/accept`), é atômico e de uso único; convite inexistente, expirado, revogado ou usado dá a mesma resposta 404. Cota: membros + convites pendentes ≤ `quota.members_per_workspace` (10). Rate limit por usuário (30/10 min). Convites encerrados são apagados pelo Cron após 30 dias.

## Brand kit

Um por client (`PUT/GET .../brand-kit`): nome, logo por **URL https** (não há upload; só https, sem credenciais na URL, sem IP nem `localhost`), cor `#rrggbb` e tom de voz. Só owner/admin editam.

## Calendário

`GET/POST/PATCH/DELETE .../clients/:client/calendar`. O dia é uma **data sem horário e sem fuso** (meia-noite UTC daquela data), então "dia 15" é dia 15 para todos. Status: `idea`, `producing`, `review`, `approved`, `scheduled`, `published` (livres, sem acoplamento automático com aprovações). Responsável precisa ser membro; output vinculado precisa ser do mesmo client (outro client dá 404). Edição com `version` (409 em conflito). Cota: 500 itens por workspace. A UI tem visão mensal e semanal, arrastar e soltar (`@dnd-kit/core`, com teclado) e formulário como alternativa acessível. Não publica nada e não tem edição offline.

## Aprovações

Pedido por output (`POST .../outputs/:id/approvals`) guarda a **versão** do output. Editar o output depois torna a decisão obsoleta: decidir devolve 409 `version_conflict` e a UI mostra "alterado depois da aprovação"; um novo pedido substitui o pendente antigo. Decidir exige owner/admin. Em equipe com 2+ owner/admin, quem pediu não decide o próprio pedido; com um só, pode; no workspace pessoal o próprio usuário faz a segunda etapa. Caixa de entrada: `GET /api/workspaces/:ws/approvals`.

## Compartilhamento

`POST .../shared-links {outputIds (1..50), expiresInDays 1..30}` (owner/admin). A UI mostra uma **confirmação explícita** do que ficará público antes de criar (R6). O link `/s/<token>` abre sem login e devolve **apenas** os outputs escolhidos e o brand kit; nunca texto-fonte, transcrição, áudio, vídeo, cortes ou outros outputs. Revogável a qualquer momento; expira em até 30 dias. Cota: 50 links ativos por workspace. Respostas: `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`. Cada acesso gera, no máximo, 1 registro por visitante a cada 10 min (`shared_link_access_logs`: hash anônimo do IP e navegador); o Cron apaga registros com mais de 90 dias. Rate limit público: 120 leituras/10 min por visitante.

## Isolamento

Toda rota passa por `requireAuth → workspaceContext (não-membro = 404) → clientContext`. Ids de outro client ou workspace (outputs, itens do calendário, links) dão 404 e nunca vazam existência. **Limite conhecido:** não há permissões por client; todo membro vê todos os clients do workspace (ver `docs/limitations.md`).

## Testes

`apps/api/test/team.test.ts` (16 testes: convites, papéis, aprovações, calendário, brand kit, links, isolamento), `packages/shared` (datas e validação do brand kit) e E2E: convite + aprovação, calendário com arrastar, brand kit + compartilhamento, isolamento.
