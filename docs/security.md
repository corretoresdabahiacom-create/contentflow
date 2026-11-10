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

## Transcrição (Fase 3)
- Áudio **nunca** chega ao servidor: o player usa `blob:` URL local; os testes E2E verificam que nenhuma requisição não-GET carrega o arquivo. O servidor só recebe texto/segmentos, revalida (ordem, tempos, tamanhos) e **deriva o texto dos segmentos** em vez de confiar no texto enviado.
- O rascunho em `processing_jobs.payload_json` é apagado ao concluir, cancelar, falhar ou por expiração (cron, 7 dias). Transições de estado são atômicas; ação fora de estado = 409.
- **CSP (mudança):** `script-src` ganhou `'wasm-unsafe-eval'` (só permite compilar WebAssembly, não `eval` de JS); `connect-src` ganhou `huggingface.co`, `*.huggingface.co` e `*.hf.co` (download do modelo Whisper, só no modo WASM); `media-src 'self' blob:` para o player. Sem CDN de scripts: os `.wasm` do onnxruntime são servidos da mesma origem. Risco aceito: um XSS futuro poderia alcançar esses hosts de modelo; a superfície continua sem `unsafe-eval`/`unsafe-inline` em scripts.
- Mobile fica bloqueado por padrão no modo WASM (proteção do dispositivo do usuário, não do servidor).

## Cortes e canais (Fase 4)
- Os cortes são calculados no navegador, então um cliente pode gravar justificativa/sinais falsos **no próprio projeto** (mesmo trade-off da análise de texto); nenhum outro tenant é afetado. O servidor valida intervalo, tamanhos, `origin` e que `transcriptId` pertence ao mesmo projeto e workspace (404 caso contrário).
- Edição de corte usa `version`; regenerar nunca apaga cortes manuais ou editados. Canais são uma lista fechada; `source_kind` das saídas continua forçado a `template` no servidor.

## Equipes, convites e links públicos (Fase 6)
- Tokens de convite e de link compartilhado têm 256 bits aleatórios, aparecem uma vez e só o SHA-256 fica no banco. Inválido, expirado, revogado e usado dão a mesma resposta 404.
- O link público devolve só os outputs escolhidos e o brand kit (teste verifica que o texto-fonte e outros outputs não aparecem). Cabeçalhos `noindex` e `no-referrer` nas rotas `/s/*`, `/invite/*` e `/api/shared/*`.
- Registro de acesso minimiza dados: hash do IP com pepper e `User-Agent` truncado; dedupe de 10 min; retenção de 90 dias.
- `img-src` da CSP agora permite `https:` para o logo do brand kit. Imagens não executam código; o custo é que quem abre uma página com logo faz uma requisição ao host informado pelo admin (o logo só aceita https, sem credenciais, sem IP/`localhost`).
- Separação de papéis nas aprovações e proteção de versão (decisão só vale para a versão pedida).
- Risco aceito: sem permissões por client (todo membro vê todos os clients do workspace).

## Headers e dados
API: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cache-Control: no-store`. Frontend (`apps/web/public/_headers`): CSP restritiva (só `self` e `challenges.cloudflare.com`). O service worker **não** faz cache de `/api` nem de dados privados; só do shell e assets. Logs de auditoria guardam IP com hash, nunca o IP, a senha ou a chave. Lint (`no-restricted-syntax`) proíbe gravar credenciais em storage.

## Fora de escopo nesta fase
Verificação de e-mail, 2FA, revisão externa de segurança (Fase 7), upload de arquivos.
