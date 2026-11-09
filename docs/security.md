# Segurança (Fase 1)

## Autenticação
- **Derivação no navegador.** O Worker Free tem **10 ms de CPU**; PBKDF2/bcrypt no servidor estouraria. O navegador deriva uma chave com PBKDF2-SHA256 (600.000 iterações, salt `contentflow:v1:<email>`) e envia só essa chave (43 caracteres base64url). A senha nunca sai do navegador.
- **No servidor:** `HMAC-SHA256(SESSION_PEPPER, salt_do_usuario:chave)` (hex de 64 chars), comparação em tempo constante. Custo de CPU desprezível. O pepper é um secret do Worker (`wrangler secret put SESSION_PEPPER`, ≥ 32 caracteres); sem ele a auth responde **503**.
- **Limites desta abordagem (decisão aprovada em 2026-11-09):** quem obtiver o banco **e** o pepper pode testar senhas, mas cada tentativa custa 600 mil iterações de PBKDF2 (a chave é derivada no cliente). A força é equivalente a PBKDF2 no cliente + HMAC no servidor, não a bcrypt/Argon2 no servidor. A chave derivada funciona como a "senha" na rede: TLS é obrigatório.
- **Hipótese ainda não medida:** o custo real de CPU do Worker no Cloudflare só pode ser confirmado após o deploy (o `wrangler dev` local não impõe os 10 ms). Medir com `wrangler tail`/analytics e registrar aqui. Se estourar, reduzir trabalho por requisição antes de qualquer outra mudança.
- **Sem recuperação de senha** (não há e-mail transacional). Declarado em `docs/limitations.md`.

## Sessão
- Cookie `__Host-cf_session`; `HttpOnly; Secure; SameSite=Lax; Path=/`. Token aleatório de 32 bytes; o banco guarda só o SHA-256.
- Validade de 30 dias; **rotação** após 24 h de uso (1 escrita por sessão por dia); o token anterior vale 60 s para não derrubar requisições em voo.
- Logout apaga a sessão no servidor e limpa o cookie. Cron horário remove sessões expiradas.

## CSRF
`SameSite=Lax` mais exigência de cabeçalho `Origin` igual à origem do Worker (ou presente em `ALLOWED_ORIGINS`) em todo método não idempotente. Sem `Origin` = 403.

## Anti-bot
Turnstile em cadastro e login, **falha fechada**: sem `TURNSTILE_SECRET` fora de `ENVIRONMENT=development` o servidor responde 503 `turnstile_not_configured` e a UI mostra "não configurado" e bloqueia o formulário. Erro de rede na verificação = bloqueio. Em desenvolvimento, o bypass é explícito e visível na UI.

## Rate limit
Contadores por janela em D1 (por IP com hash e por e-mail com hash). Cada tentativa = 1 escrita (orçamento: 100 mil/dia). **Risco conhecido:** um atacante pode gastar o orçamento de escritas e causar indisponibilidade parcial; o Turnstile reduz isso. Revisar na Fase 7.

## Isolamento
Não-membro de workspace recebe 404 (não revela existência); papel insuficiente, 403. Client e projeto precisam pertencer ao workspace/client da URL. Cobertura em `apps/api/test/isolation.test.ts` e `e2e/app.spec.ts`.

## Texto, arquivos e saídas (Fase 2)
- Arquivos (.docx, .pdf etc.) **nunca chegam ao servidor**: são lidos no navegador (mammoth, unpdf, limite de 10 MB) e só o texto extraído é enviado (máx. 200.000 caracteres, validado também no servidor com zod). Isso evita parsing de formatos complexos no Worker e qualquer armazenamento de arquivo.
- A análise (idioma, palavras-chave, resumo) roda no navegador; o servidor valida o formato do resultado, não o recalcula. Um cliente malicioso pode gravar uma análise falsa **no próprio projeto**; isso não afeta outros tenants e é aceito.
- O servidor força `source_kind='template'` nas saídas; um cliente não consegue rotular conteúdo como "AI" ou "wasm".
- Toda rota de projeto/saída/exportação passa por `requireAuth → workspaceContext → clientContext → projectContext`, e as queries filtram também por `workspace_id`. Outro tenant recebe 404 (testado em API e E2E). Papéis: `member` cria projetos e edita saídas; `admin`/`owner` administram clientes e apagam projetos.
- A exportação CSV neutraliza injeção de fórmula; nomes de arquivo são higienizados.
- Texto renderizado no React sem `dangerouslySetInnerHTML`; saídas editáveis aparecem só em `<textarea>`.

## Headers e dados
API: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`. Frontend (`apps/web/public/_headers`): CSP restritiva (só `self` e `challenges.cloudflare.com`). O service worker **não** faz cache de `/api` nem de dados privados; só do shell e assets. Logs de auditoria guardam IP com hash, nunca o IP, a senha ou a chave. Lint (`no-restricted-syntax`) proíbe gravar credenciais em storage.

## Fora de escopo nesta fase
Verificação de e-mail, 2FA, revisão externa de segurança (Fase 7), upload de arquivos.
