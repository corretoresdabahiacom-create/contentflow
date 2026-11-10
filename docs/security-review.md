# Revisão de segurança (Fase 7)

Método: leitura das rotas e middlewares das Fases 1–7 contra a lista do briefing, mais testes automatizados que falham se a proteção sumir. "Verificado" = coberto por teste; "Aceito" = risco conhecido e documentado.

| Item | Situação | Evidência |
|---|---|---|
| Isolamento multi-tenant | Verificado | Cadeia `requireAuth → workspaceContext (não-membro 404) → clientContext → projectContext`; ids de outro tenant dão 404. `apps/api/test/isolation.test.ts`, `team.test.ts`, E2E "isolamento" (Fases 2–6) |
| Admin global | Verificado | 404 para não-admin em todas as rotas `/api/admin/*`; sem rota que conceda admin; admin não suspende a si nem a outros admins (`admin.test.ts`) |
| CSRF | Verificado | Cookie `SameSite=Lax` + `originGuard` em todo método não idempotente (Origin ausente ou alheio = 403), inclusive `/api/reports`, admin, notificações, convites (`security.test.ts`) |
| Headers | Verificado | API: `nosniff`, `no-store`, `X-Frame-Options: DENY`; rotas públicas: `no-referrer` e `noindex`. Site (`public/_headers`): CSP e `Permissions-Policy` (sem HSTS: o HTTPS é da Cloudflare; avaliar `Strict-Transport-Security` no deploy). Servir de verdade só se confirma após o deploy |
| Rate limit | Verificado | login, cadastro, convite, link público (120/10 min) e `/report` (5/h) em D1; 429 com `Retry-After` (`admin.test.ts`, E2E de carga) |
| Bots | Verificado | Turnstile obrigatório em cadastro, login e `/report`; falha fechada (503 sem configuração) |
| Upload de arquivo malicioso | Verificado | O servidor **não recebe arquivos**: o navegador lê (limites de tamanho/tipo, `readers.ts`) e envia só texto JSON. Binário disfarçado (NUL) é recusado em fonte e outputs (400); texto > limite é recusado; nada é executado nem servido de volta como arquivo (`security.test.ts`) |
| XSS | Verificado | Sem `dangerouslySetInnerHTML`/`innerHTML` no front; React escapa; CSP restringe scripts. Denúncias com HTML/SQL ficam como texto inerte |
| Injeção SQL | Verificado | Drizzle com parâmetros; as poucas consultas `sql` cruas do admin usam valores fixos ou parâmetros; tabelas contadas vêm de lista fixa |
| Segredos | Verificado | Nenhum segredo no front nem em `localStorage`; sessão em cookie HttpOnly; tokens (sessão, convite, link) só por hash |
| Vazamento de conteúdo no admin | Verificado | O painel só devolve metadados; testes procuram o texto privado nas respostas |
| Links públicos | Aceito | Quem tem o link vê o conteúdo escolhido (por desenho, documentado); expira e revoga |
| Logo por URL externa | Aceito | Quem abre um link com logo faz requisição a esse host (CSP `img-src https:`) |
| Sem permissões por client | Aceito | Todo membro vê todos os clients do workspace (docs/team-calendar.md) |
| Antivírus de arquivos | Não aplicável | Não há armazenamento de arquivos (R2 excluído) |
| Dependências | Verificado | `pnpm audit --audit-level=high` roda no CI. Em 2026-11-10 havia 9 avisos altos, todos transitivos (`protobufjs` e `sharp` via `@xenova/transformers`; `basic-ftp` via `@lhci/cli`); foram corrigidos com `pnpm.overrides` em `package.json` e a suíte continuou verde. Restam 1 baixo e 2 moderados, sem correção disponível ou só em ferramenta de desenvolvimento. Novas devDependencies da fase: `@lhci/cli`, `autocannon` (previstas na §5.2 do briefing, só desenvolvimento) |
| Admin sem 2º fator | Aceito | Uma conta admin comprometida age como admin. Mitigação: poucas contas, senha forte; 2FA fica fora do escopo gratuito desta versão |

## Corrigido durante a revisão
- Texto com byte NUL (binário disfarçado) era aceito em fonte e outputs; agora é recusado.
