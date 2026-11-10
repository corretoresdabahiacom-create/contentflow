# Limitações do ContentFlow AI

> Documento público, gerado a partir de `apps/web/src/limitations/data.ts`. **Não edite este arquivo diretamente.** Rode `pnpm gen:limitations`.

**Versão:** 0.5.0 · **Última atualização:** 2026-11-09

## Sumário

- [Transcrição de áudio/vídeo no servidor](#limitacao-transcricao-de-audio-video-no-servidor) — _Indisponível_
- [Transcrição no navegador (WASM, experimental)](#limitacao-transcricao-no-navegador-wasm) — _Experimental_
- [Renderização de vídeo](#limitacao-renderizacao-de-video) — _Indisponível_
- [Upload e armazenamento de arquivos de mídia](#limitacao-upload-de-midia) — _Indisponível_
- [Recuperação de senha por e-mail](#limitacao-recuperacao-de-senha) — _Indisponível_
- [Formatos de entrada e geração por template](#limitacao-formatos-de-entrada-e-geracao) — _Limitado_
- [Publicação automática em redes sociais](#limitacao-publicacao-automatica-em-redes-sociais) — _Indisponível_
- [Geração por IA generativa](#limitacao-ia-externa) — _Indisponível_
- [Sugestões de corte por heurística textual](#limitacao-cortes-por-heuristica-textual) — _Limitado_
- [Análise de emoção, expressão facial ou viralidade](#limitacao-analise-de-emocao-e-viralidade) — _Indisponível_
- [Notificações push](#limitacao-push-notifications) — _Indisponível_
- [Edição colaborativa em tempo real](#limitacao-edicao-colaborativa-em-tempo-real) — _Indisponível_
- [Integração com Drive, Dropbox ou OneDrive](#limitacao-integracoes-com-nuvem-externa) — _Indisponível_
- [PDF com marca do cliente aplicada](#limitacao-pdf-com-brand-kit) — _Indisponível_
- [Planos pagos e cobrança](#limitacao-planos-pagos) — _Indisponível_
- [Quotas do plano gratuito (MVP)](#limitacao-quotas-do-plano-gratuito) — _Limitado_
- [Escopo de links públicos](#limitacao-compartilhamento-publico) — _Limitado_
- [Retenção de dados](#limitacao-retencao-de-dados) — _Limitado_
- [Compatibilidade de navegador](#limitacao-compatibilidade-de-navegador) — _Limitado_
- [Direitos sobre o conteúdo enviado](#limitacao-direitos-sobre-o-conteudo) — _Limitado_
- [Denúncias e moderação](#limitacao-denuncias-e-moderacao) — _Limitado_

<a id="limitacao-transcricao-de-audio-video-no-servidor"></a>

## Transcrição de áudio/vídeo no servidor

**Status:** Indisponível

Transcrição automática de mídia exige infraestrutura com GPU/CPU dedicada, incompatível com a restrição de custo zero (o Worker gratuito tem 10 ms de CPU por requisição).

**O que você pode fazer:**

- Colar a transcrição manualmente (recomendado).
- Enviar um arquivo .srt ou .vtt já pronto.
- Usar transcrição no navegador (experimental, desktop; o áudio não sai do seu computador) — ver a limitação própria deste modo.
- Rodar Whisper localmente e importar o resultado — ver docs/self-host.md.

**Ver também:** [Transcrição no navegador (WASM, experimental)](#limitacao-transcricao-no-navegador-wasm), [Renderização de vídeo](#limitacao-renderizacao-de-video), [Geração por IA generativa](#limitacao-ia-externa), [Upload e armazenamento de arquivos de mídia](#limitacao-upload-de-midia)

_Referência interna:_ `docs/free-tier-limits.md#1-cloudflare-workers-free`

<a id="limitacao-transcricao-no-navegador-wasm"></a>

## Transcrição no navegador (WASM, experimental)

**Status:** Experimental

Um modelo Whisper pequeno roda no seu navegador, com o custo no seu dispositivo: baixa cerca de 40–80 MB na primeira vez (do Hugging Face), precisa de uns 4 GB de memória, leva de 1 a 3 vezes a duração do áudio e aceita até 10 minutos. A qualidade é baixa, principalmente em português e espanhol. Fica bloqueado por padrão em celulares e tablets. Este modo foi implementado e tem testes automáticos para os bloqueios e para a conversão de resultados, mas a transcrição de ponta a ponta ainda não foi executada em um navegador real (exige teste manual em desktop).

**O que você pode fazer:**

- Colar a transcrição (modo principal, sempre disponível).
- Importar um arquivo .srt ou .vtt já pronto.
- Rodar Whisper no seu computador e importar o resultado — ver docs/self-host.md.

**Ver também:** [Transcrição de áudio/vídeo no servidor](#limitacao-transcricao-de-audio-video-no-servidor), [Upload e armazenamento de arquivos de mídia](#limitacao-upload-de-midia)

_Referência interna:_ `docs/transcription.md`

<a id="limitacao-renderizacao-de-video"></a>

## Renderização de vídeo

**Status:** Indisponível

Edição de vídeo exige ffmpeg e CPU/GPU além do que a infraestrutura gratuita permite no servidor.

**O que você pode fazer:**

- Exportar um plano de edição com timestamps e roteiro.
- Exportar legendas em .srt/.vtt.
- Se o teste de viabilidade passar: corte experimental no navegador (opt-in, até 3 min, apenas desktop).

**Ver também:** [Transcrição de áudio/vídeo no servidor](#limitacao-transcricao-de-audio-video-no-servidor)

_Referência interna:_ `docs/video-viability.md`

<a id="limitacao-upload-de-midia"></a>

## Upload e armazenamento de arquivos de mídia

**Status:** Indisponível

Nesta fase não há armazenamento de arquivos: o único storage da Cloudflare (R2) pode exigir cartão de crédito, o que o projeto proíbe. Só texto é guardado.

**O que você pode fazer:**

- Colar texto ou importar .txt, .md, .docx, .pdf, .csv, .json (lidos no seu navegador; só o texto é enviado).
- Colar a transcrição ou importar .srt/.vtt.
- Rodar a transcrição no seu computador (WASM ou self-host) e enviar apenas o texto.

**Ver também:** [Transcrição de áudio/vídeo no servidor](#limitacao-transcricao-de-audio-video-no-servidor), [Retenção de dados](#limitacao-retencao-de-dados)

_Referência interna:_ `docs/free-tier-limits.md#decisões-aprovadas-em-2026-11-09`

<a id="limitacao-recuperacao-de-senha"></a>

## Recuperação de senha por e-mail

**Status:** Indisponível

O projeto não usa e-mail transacional (serviço pago ou com cartão), então não há como enviar um link de redefinição. Se você perder a senha, a conta não pode ser recuperada.

**O que você pode fazer:**

- Guardar a senha em um gerenciador de senhas.
- Exportar seus projetos periodicamente (TXT, MD, CSV ou JSON).

<a id="limitacao-formatos-de-entrada-e-geracao"></a>

## Formatos de entrada e geração por template

**Status:** Limitado

A entrada aceita colagem de texto e arquivos .txt, .md, .docx, .pdf, .csv e .json, lidos no navegador (até 10 MB e 200.000 caracteres de texto). PDFs escaneados não têm texto extraível e não há OCR. As saídas são montadas por templates fixos; palavras-chave e resumo usam métodos estatísticos clássicos, não IA generativa.

**O que você pode fazer:**

- Para PDFs escaneados, rodar OCR fora do produto e colar o texto.
- Revisar e editar cada saída: elas são rascunhos rotulados como template.
- Por canal (YouTube, Instagram, TikTok, LinkedIn, Facebook, Blog, E-mail) os limites de caracteres são aproximados: confira cada plataforma antes de publicar.
- Outros formatos (.pptx, .xlsx, .odt, .rtf) não são prometidos; converta para .docx, .txt ou .csv.

<a id="limitacao-publicacao-automatica-em-redes-sociais"></a>

## Publicação automática em redes sociais

**Status:** Indisponível

APIs oficiais de publicação exigem revisão de app e, em vários casos, infraestrutura paga.

**O que você pode fazer:**

- Gerar o conteúdo no calendário editorial.
- Marcar como aprovado e, após postar manualmente, como publicado.
- Exportar texto e colar na plataforma de destino.

<a id="limitacao-ia-externa"></a>

## Geração por IA generativa

**Status:** Indisponível

APIs generativas são pagas ou exigem cartão de crédito — incompatível com as restrições do projeto.

**O que você pode fazer:**

- Usar templates determinísticos marcados com selo "template".
- Configurar seu próprio provedor OpenAI-compatible (desligado por padrão; chave sua, custo seu, consentimento explícito).

**Ver também:** [Transcrição de áudio/vídeo no servidor](#limitacao-transcricao-de-audio-video-no-servidor)

<a id="limitacao-cortes-por-heuristica-textual"></a>

## Sugestões de corte por heurística textual

**Status:** Limitado

Os cortes são sugeridos só a partir do texto e dos timestamps da transcrição (mudança de assunto, pausas, perguntas, imperativos, números, citações e palavras-chave). Exigem uma transcrição com timestamps (.srt/.vtt ou modo no navegador); texto colado sem tempos não gera cortes. A heurística erra: o motivo de cada sugestão é sempre exibido para você julgar e editar. O produto não corta nem renderiza o vídeo.

**O que você pode fazer:**

- Editar início, fim, título e notas de qualquer sugestão, ou criar cortes à mão.
- Exportar os cortes (JSON/MD/TXT) como roteiro para editar em outro programa.

**Ver também:** [Análise de emoção, expressão facial ou viralidade](#limitacao-analise-de-emocao-e-viralidade), [Renderização de vídeo](#limitacao-renderizacao-de-video)

_Referência interna:_ `docs/clips.md`

<a id="limitacao-analise-de-emocao-e-viralidade"></a>

## Análise de emoção, expressão facial ou viralidade

**Status:** Indisponível

Exige visão computacional e análise de áudio, incompatíveis com a infraestrutura gratuita.

**O que você pode fazer:**

- Ver a justificativa textual de cada sugestão de corte e julgar você mesmo.

<a id="limitacao-push-notifications"></a>

## Notificações push

**Status:** Indisponível

Web Push depende de serviços externos dos fabricantes de navegador.

**O que você pode fazer:**

- Receber notificações dentro do app (ícone de sino).

<a id="limitacao-edicao-colaborativa-em-tempo-real"></a>

## Edição colaborativa em tempo real

**Status:** Indisponível

Requer CRDT/OT e sincronização em tempo real, fora do escopo do MVP.

**O que você pode fazer:**

- Editar em sequência; o sistema avisa sobre versões concorrentes e mostra diff.

<a id="limitacao-integracoes-com-nuvem-externa"></a>

## Integração com Drive, Dropbox ou OneDrive

**Status:** Indisponível

Exigiria OAuth e revisão de app em cada provedor.

**O que você pode fazer:**

- Fazer upload e download de arquivos manualmente.

<a id="limitacao-pdf-com-brand-kit"></a>

## PDF com marca do cliente aplicada

**Status:** Indisponível

Exportação em PDF com brand kit não está implementada nesta fase.

**O que você pode fazer:**

- Exportar em HTML/MD.
- O brand kit aplica-se apenas à página de prévia compartilhada.

<a id="limitacao-planos-pagos"></a>

## Planos pagos e cobrança

**Status:** Indisponível

Monetização está desligada por feature flag. Nenhuma rota de cobrança existe.

**O que você pode fazer:**

- Usar todas as funcionalidades dentro das quotas do plano gratuito.

<a id="limitacao-quotas-do-plano-gratuito"></a>

## Quotas do plano gratuito (MVP)

**Status:** Limitado

O plano gratuito tem quotas para manter o custo operacional em zero. A capacidade total da plataforma é limitada pelo banco gratuito (500 MB).

| Item | Valor |
|---|---|
| Armazenamento de arquivos | indisponível nesta fase |
| Projetos por workspace | 100 |
| Transcrições por mês | 200 |
| Segmentos por transcrição (SRT/VTT/WASM) | 1.000 |
| Jobs de transcrição abertos por projeto | 5 |
| Exportações por mês | 500 |
| Membros por workspace | 10 |
| Clientes por workspace (agência) | 10 |
| Saídas por projeto | 200 |
| Tamanho do texto-fonte | 200.000 caracteres |

**O que você pode fazer:**

- As operações são recusadas com mensagem clara ao atingir a quota.

_Referência interna:_ `docs/free-tier-limits.md#2-cloudflare-d1-free`

<a id="limitacao-compartilhamento-publico"></a>

## Escopo de links públicos

**Status:** Limitado

Links públicos expõem apenas outputs selecionados e brand kit — nunca o arquivo original, áudio, vídeo ou transcrição integral.

**O que você pode fazer:**

- Revogar qualquer link público em Configurações → Compartilhamento.

<a id="limitacao-retencao-de-dados"></a>

## Retenção de dados

**Status:** Limitado

Cada tipo de dado tem retenção padrão definida.

| Item | Valor |
|---|---|
| Arquivos-fonte | não armazenados nesta fase |
| Textos gerados | até exclusão do projeto |
| Transcrições | enquanto o projeto existir |
| Logs de auditoria | 180 dias |
| Denúncias | 180 dias após resolução |
| Sessões | 30 dias |

**O que você pode fazer:**

- Exportar ou excluir todos os seus dados em Configurações → Privacidade.

<a id="limitacao-compatibilidade-de-navegador"></a>

## Compatibilidade de navegador

**Status:** Limitado

Funcionalidades experimentais não funcionam em todos os navegadores.

**O que você pode fazer:**

- Usar Chrome/Edge/Firefox desktop para recursos experimentais.
- A PWA funciona em Chrome/Edge (desktop e Android) e Safari iOS com limitações.

<a id="limitacao-direitos-sobre-o-conteudo"></a>

## Direitos sobre o conteúdo enviado

**Status:** Limitado

O produto não verifica direitos autorais. Ao enviar, você confirma que possui direitos ou autorização.

**O que você pode fazer:**

- Enviar apenas conteúdo próprio ou autorizado.
- Denunciar conteúdo indevido em /report.

<a id="limitacao-denuncias-e-moderacao"></a>

## Denúncias e moderação

**Status:** Limitado

Denúncias são tratadas manualmente pela administração.

**O que você pode fazer:**

- Enviar denúncia em /report.
- Prazo de resposta: até 5 dias úteis.
