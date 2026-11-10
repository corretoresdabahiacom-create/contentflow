// Fonte única de verdade para limitações do produto.
// Consumido por: UI (<Limitation />), docs/limitations.md (via script) e mensagens de erro.
// IMPORTANTE: nunca editar docs/limitations.md diretamente. Rodar: pnpm gen:limitations

export type LimitationStatus = 'not_available' | 'limited' | 'experimental';

export type Limitation = {
  /** Âncora estável, URL-safe. Nunca renomear após publicar. */
  id: string;
  title: string;
  status: LimitationStatus;
  /** Motivo em uma frase, sem marketing. */
  reason: string;
  /** Alternativas concretas. Nunca vazio. */
  alternatives: string[];
  inlineNotice?: string;
  quotas?: { label: string; value: string }[];
  related?: string[];
  sourceDoc?: string;
};

export const limitations: readonly Limitation[] = [
  {
    id: 'transcricao-de-audio-video-no-servidor',
    title: 'Transcrição de áudio/vídeo no servidor',
    status: 'not_available',
    reason:
      'Transcrição automática de mídia exige infraestrutura com GPU/CPU dedicada, incompatível com a restrição de custo zero (o Worker gratuito tem 10 ms de CPU por requisição).',
    alternatives: [
      'Colar a transcrição manualmente (recomendado).',
      'Enviar um arquivo .srt ou .vtt já pronto.',
      'Usar transcrição no navegador (experimental, desktop; o áudio não sai do seu computador) — ver a limitação própria deste modo.',
      'Rodar Whisper localmente e importar o resultado — ver docs/self-host.md.',
    ],
    inlineNotice: 'Transcrição no servidor não está disponível.',
    related: ['transcricao-no-navegador-wasm', 'renderizacao-de-video', 'ia-externa', 'upload-de-midia'],
    sourceDoc: 'docs/free-tier-limits.md#1-cloudflare-workers-free',
  },
  {
    id: 'transcricao-no-navegador-wasm',
    title: 'Transcrição no navegador (WASM, experimental)',
    status: 'experimental',
    reason:
      'Um modelo Whisper pequeno roda no seu navegador, com o custo no seu dispositivo: baixa cerca de 40–80 MB na primeira vez (do Hugging Face), precisa de uns 4 GB de memória, leva de 1 a 3 vezes a duração do áudio e aceita até 10 minutos. A qualidade é baixa, principalmente em português e espanhol. Fica bloqueado por padrão em celulares e tablets. Este modo foi implementado e tem testes automáticos para os bloqueios e para a conversão de resultados, mas a transcrição de ponta a ponta ainda não foi executada em um navegador real (exige teste manual em desktop).',
    alternatives: [
      'Colar a transcrição (modo principal, sempre disponível).',
      'Importar um arquivo .srt ou .vtt já pronto.',
      'Rodar Whisper no seu computador e importar o resultado — ver docs/self-host.md.',
    ],
    inlineNotice: 'Transcrição no navegador é experimental, lenta e pode falhar; use só no desktop.',
    related: ['transcricao-de-audio-video-no-servidor', 'upload-de-midia'],
    sourceDoc: 'docs/transcription.md',
  },
  {
    id: 'renderizacao-de-video',
    title: 'Renderização de vídeo',
    status: 'not_available',
    reason:
      'Edição de vídeo exige ffmpeg e CPU/GPU além do que a infraestrutura gratuita permite no servidor. O corte experimental no navegador (ffmpeg.wasm) só seria oferecido se um teste empírico em máquina real provasse viabilidade; esse teste ainda não foi executado (status blocked), então o corte de vídeo não está habilitado e a flag video_render_enabled continua desligada. O produto entrega o plano de edição exportável.',
    alternatives: [
      'Exportar o plano de edição (TXT, MD, CSV ou JSON) com timecodes IN/OUT, roteiro e notas, e cortar no CapCut, Premiere, DaVinci Resolve, Final Cut ou Descript.',
      'Exportar legendas em .srt/.vtt.',
      'Reabrir a decisão rodando o protocolo de docs/video-viability.md numa máquina real.',
    ],
    inlineNotice: 'O ContentFlow não corta nem renderiza vídeo: exporte o plano de edição.',
    related: ['transcricao-de-audio-video-no-servidor'],
    sourceDoc: 'docs/video-viability.md',
  },
  {
    id: 'upload-de-midia',
    title: 'Upload e armazenamento de arquivos de mídia',
    status: 'not_available',
    reason:
      'Nesta fase não há armazenamento de arquivos: o único storage da Cloudflare (R2) pode exigir cartão de crédito, o que o projeto proíbe. Só texto é guardado.',
    alternatives: [
      'Colar texto ou importar .txt, .md, .docx, .pdf, .csv, .json (lidos no seu navegador; só o texto é enviado).',
      'Colar a transcrição ou importar .srt/.vtt.',
      'Rodar a transcrição no seu computador (WASM ou self-host) e enviar apenas o texto.',
    ],
    inlineNotice: 'Upload de áudio e vídeo não está disponível.',
    related: ['transcricao-de-audio-video-no-servidor', 'retencao-de-dados'],
    sourceDoc: 'docs/free-tier-limits.md#decisões-aprovadas-em-2026-11-09',
  },
  {
    id: 'recuperacao-de-senha',
    title: 'Recuperação de senha por e-mail',
    status: 'not_available',
    reason:
      'O projeto não usa e-mail transacional (serviço pago ou com cartão), então não há como enviar um link de redefinição. Se você perder a senha, a conta não pode ser recuperada.',
    alternatives: [
      'Guardar a senha em um gerenciador de senhas.',
      'Exportar seus projetos periodicamente (TXT, MD, CSV ou JSON).',
    ],
    inlineNotice: 'Não há recuperação de senha por e-mail.',
  },
  {
    id: 'formatos-de-entrada-e-geracao',
    title: 'Formatos de entrada e geração por template',
    status: 'limited',
    reason:
      'A entrada aceita colagem de texto e arquivos .txt, .md, .docx, .pdf, .csv e .json, lidos no navegador (até 10 MB e 200.000 caracteres de texto). PDFs escaneados não têm texto extraível e não há OCR. As saídas são montadas por templates fixos; palavras-chave e resumo usam métodos estatísticos clássicos, não IA generativa.',
    alternatives: [
      'Para PDFs escaneados, rodar OCR fora do produto e colar o texto.',
      'Revisar e editar cada saída: elas são rascunhos rotulados como template.',
      'Por canal (YouTube, Instagram, TikTok, LinkedIn, Facebook, Blog, E-mail) os limites de caracteres são aproximados: confira cada plataforma antes de publicar.',
      'Outros formatos (.pptx, .xlsx, .odt, .rtf) não são prometidos; converta para .docx, .txt ou .csv.',
    ],
    inlineNotice: 'Saídas são geradas por template, sem IA, e PDFs escaneados não são lidos.',
  },
  {
    id: 'publicacao-automatica-em-redes-sociais',
    title: 'Publicação automática em redes sociais',
    status: 'not_available',
    reason:
      'APIs oficiais de publicação exigem revisão de app e, em vários casos, infraestrutura paga.',
    alternatives: [
      'Gerar o conteúdo no calendário editorial.',
      'Marcar como aprovado e, após postar manualmente, como publicado.',
      'Exportar texto e colar na plataforma de destino.',
    ],
    inlineNotice: 'Publicação é manual.',
  },
  {
    id: 'ia-externa',
    title: 'Geração por IA generativa',
    status: 'not_available',
    reason:
      'APIs generativas são pagas ou exigem cartão de crédito — incompatível com as restrições do projeto.',
    alternatives: [
      'Usar templates determinísticos marcados com selo "template".',
      'Configurar seu próprio provedor OpenAI-compatible (desligado por padrão; chave sua, custo seu, consentimento explícito).',
    ],
    inlineNotice: 'Saídas por template não são IA.',
    related: ['transcricao-de-audio-video-no-servidor'],
  },
  {
    id: 'cortes-por-heuristica-textual',
    title: 'Sugestões de corte por heurística textual',
    status: 'limited',
    reason:
      'Os cortes são sugeridos só a partir do texto e dos timestamps da transcrição (mudança de assunto, pausas, perguntas, imperativos, números, citações e palavras-chave). Exigem uma transcrição com timestamps (.srt/.vtt ou modo no navegador); texto colado sem tempos não gera cortes. A heurística erra: o motivo de cada sugestão é sempre exibido para você julgar e editar. O produto não corta nem renderiza o vídeo.',
    alternatives: [
      'Editar início, fim, título e notas de qualquer sugestão, ou criar cortes à mão.',
      'Exportar os cortes (JSON/MD/TXT) como roteiro para editar em outro programa.',
    ],
    inlineNotice: 'Sugestões vêm de uma heurística de texto; confira cada uma.',
    related: ['analise-de-emocao-e-viralidade', 'renderizacao-de-video'],
    sourceDoc: 'docs/clips.md',
  },
  {
    id: 'analise-de-emocao-e-viralidade',
    title: 'Análise de emoção, expressão facial ou viralidade',
    status: 'not_available',
    reason:
      'Exige visão computacional e análise de áudio, incompatíveis com a infraestrutura gratuita.',
    alternatives: ['Ver a justificativa textual de cada sugestão de corte e julgar você mesmo.'],
    inlineNotice: 'Sugestões são baseadas em heurística textual.',
  },
  {
    id: 'push-notifications',
    title: 'Notificações push',
    status: 'not_available',
    reason: 'Web Push depende de serviços externos dos fabricantes de navegador.',
    alternatives: ['Receber notificações dentro do app (ícone de sino).'],
  },
  {
    id: 'edicao-colaborativa-em-tempo-real',
    title: 'Edição colaborativa em tempo real',
    status: 'not_available',
    reason: 'Requer CRDT/OT e sincronização em tempo real, fora do escopo do MVP.',
    alternatives: [
      'Editar em sequência; o sistema avisa sobre versões concorrentes e mostra diff.',
    ],
  },
  {
    id: 'integracoes-com-nuvem-externa',
    title: 'Integração com Drive, Dropbox ou OneDrive',
    status: 'not_available',
    reason: 'Exigiria OAuth e revisão de app em cada provedor.',
    alternatives: ['Fazer upload e download de arquivos manualmente.'],
  },
  {
    id: 'pdf-com-brand-kit',
    title: 'PDF com marca do cliente aplicada',
    status: 'not_available',
    reason: 'Exportação em PDF com brand kit não está implementada nesta fase.',
    alternatives: [
      'Exportar em HTML/MD.',
      'O brand kit aplica-se apenas à página de prévia compartilhada.',
    ],
  },
  {
    id: 'planos-pagos',
    title: 'Planos pagos e cobrança',
    status: 'not_available',
    reason: 'Monetização está desligada por feature flag. Nenhuma rota de cobrança existe.',
    alternatives: ['Usar todas as funcionalidades dentro das quotas do plano gratuito.'],
  },
  {
    id: 'quotas-do-plano-gratuito',
    title: 'Quotas do plano gratuito (MVP)',
    status: 'limited',
    reason:
      'O plano gratuito tem quotas para manter o custo operacional em zero. A capacidade total da plataforma é limitada pelo banco gratuito (500 MB).',
    alternatives: ['As operações são recusadas com mensagem clara ao atingir a quota.'],
    quotas: [
      { label: 'Armazenamento de arquivos', value: 'indisponível nesta fase' },
      { label: 'Projetos por workspace', value: '100' },
      { label: 'Transcrições por mês', value: '200' },
      { label: 'Segmentos por transcrição (SRT/VTT/WASM)', value: '1.000' },
      { label: 'Jobs de transcrição abertos por projeto', value: '5' },
      { label: 'Exportações por mês', value: '500' },
      { label: 'Membros por workspace', value: '10' },
      { label: 'Clientes por workspace (agência)', value: '10' },
      { label: 'Saídas por projeto', value: '200' },
      { label: 'Tamanho do texto-fonte', value: '200.000 caracteres' },
    ],
    sourceDoc: 'docs/free-tier-limits.md#2-cloudflare-d1-free',
  },
  {
    id: 'compartilhamento-publico',
    title: 'Escopo de links públicos',
    status: 'limited',
    reason:
      'Links públicos expõem apenas outputs selecionados e brand kit — nunca o arquivo original, áudio, vídeo ou transcrição integral.',
    alternatives: ['Revogar qualquer link público em Configurações → Compartilhamento.'],
  },
  {
    id: 'retencao-de-dados',
    title: 'Retenção de dados',
    status: 'limited',
    reason: 'Cada tipo de dado tem retenção padrão definida.',
    alternatives: ['Exportar ou excluir todos os seus dados em Configurações → Privacidade.'],
    quotas: [
      { label: 'Arquivos-fonte', value: 'não armazenados nesta fase' },
      { label: 'Textos gerados', value: 'até exclusão do projeto' },
      { label: 'Transcrições', value: 'enquanto o projeto existir' },
      { label: 'Logs de auditoria', value: '180 dias' },
      { label: 'Denúncias', value: '180 dias após resolução' },
      { label: 'Sessões', value: '30 dias' },
    ],
  },
  {
    id: 'compatibilidade-de-navegador',
    title: 'Compatibilidade de navegador',
    status: 'limited',
    reason: 'Funcionalidades experimentais não funcionam em todos os navegadores.',
    alternatives: [
      'Usar Chrome/Edge/Firefox desktop para recursos experimentais.',
      'A PWA funciona em Chrome/Edge (desktop e Android) e Safari iOS com limitações.',
    ],
  },
  {
    id: 'direitos-sobre-o-conteudo',
    title: 'Direitos sobre o conteúdo enviado',
    status: 'limited',
    reason:
      'O produto não verifica direitos autorais. Ao enviar, você confirma que possui direitos ou autorização.',
    alternatives: [
      'Enviar apenas conteúdo próprio ou autorizado.',
      'Denunciar conteúdo indevido em /report.',
    ],
  },
  {
    id: 'convites-por-link-sem-email',
    title: 'Convites por link (sem e-mail)',
    status: 'limited',
    reason:
      'O ContentFlow não envia e-mail: o convite é um link que você mesmo entrega. O link vale uma vez, expira (até 30 dias) e só aparece na hora da criação; quem abrir precisa estar logado. Quem tiver o link antes da pessoa certa pode entrar no lugar dela, então envie por um canal que você confia e revogue se desconfiar.',
    alternatives: [
      'Enviar o link por mensagem direta e revogar em Equipe se ele vazar.',
      'Usar a validade mais curta que couber no seu caso.',
    ],
    inlineNotice: 'Convites são links, sem e-mail.',
    sourceDoc: 'docs/team-calendar.md#convites',
  },
  {
    id: 'compartilhamento-por-link-publico',
    title: 'Compartilhamento por link público',
    status: 'limited',
    reason:
      'O link compartilhado não exige login: qualquer pessoa com o endereço lê os outputs escolhidos e o brand kit até o link expirar (até 30 dias) ou ser revogado. Nunca expõe texto-fonte, transcrição, áudio, vídeo, cortes nem outros outputs. Não há aprovação do cliente nem comentários, e o registro de acessos mostra só um identificador anônimo do visitante e o navegador, sem identificar pessoas. O logo do brand kit é carregado do endereço https que você informou, então quem abre o link faz uma requisição a esse site.',
    alternatives: [
      'Exportar o conteúdo (TXT, MD, CSV, JSON) e enviar por um canal privado.',
      'Revogar o link assim que o cliente responder.',
    ],
    inlineNotice: 'Quem tem o link vê o conteúdo compartilhado, sem login.',
    sourceDoc: 'docs/team-calendar.md#compartilhamento',
  },
  {
    id: 'permissoes-por-cliente',
    title: 'Permissões por cliente',
    status: 'not_available',
    reason:
      'O isolamento entre clients vale para os dados (um client nunca lê nem altera dados de outro por engano de rota) mas não para pessoas: todo membro do workspace enxerga todos os clients dele. Não existe acesso restrito a clients específicos.',
    alternatives: ['Criar um workspace de equipe separado para cada grupo que não deve ver os outros clients.'],
    inlineNotice: 'Membros veem todos os clients do workspace.',
    sourceDoc: 'docs/team-calendar.md#isolamento',
  },
  {
    id: 'calendario-sem-publicacao-e-sem-offline',
    title: 'Calendário editorial: só planejamento',
    status: 'limited',
    reason:
      'O calendário organiza pautas por dia (sem horário e sem fuso), com status e responsável, e nada é publicado: o status "publicado" é uma marcação sua. A edição offline do calendário ainda não existe; sem conexão a tela mostra o aviso e as alterações não são salvas.',
    alternatives: ['Postar manualmente na plataforma e marcar como publicado.', 'Editar o calendário quando estiver online.'],
    inlineNotice: 'O calendário não publica nada.',
    related: ['publicacao-automatica-em-redes-sociais'],
    sourceDoc: 'docs/team-calendar.md#calendario',
  },
  {
    id: 'denuncias-e-moderacao',
    title: 'Denúncias e moderação',
    status: 'limited',
    reason:
      'Denúncias de conteúdo compartilhado por link são tratadas manualmente pela administração. Só links compartilhados podem ser denunciados: o resto do conteúdo é privado e não é visível a terceiros. O dono é avisado dentro do produto (não por e-mail) antes de qualquer remoção, exceto em denúncias de conteúdo ilegal, que são urgentes. Remover significa revogar o link; o produto não apaga contas nem conteúdo do dono por esse caminho. Se você informar um contato, não há garantia de resposta individual.',
    alternatives: ['Enviar denúncia em /report.', 'Prazo de resposta: até 5 dias úteis.'],
    inlineNotice: 'Denúncias são analisadas manualmente.',
    sourceDoc: 'docs/moderation.md',
  },
  {
    id: 'painel-admin-sem-metricas-da-cloudflare',
    title: 'Painel de administração: consumo da Cloudflare indisponível',
    status: 'not_available',
    reason:
      'O painel global mostra contagens reais do banco (linhas por tabela, jobs, cotas por workspace), mas não mostra requisições do Worker nem leituras e escritas do D1: isso exigiria guardar um token de API da Cloudflare no servidor, que não existe. Também não há bloqueio automático em 90% do consumo global, porque esse consumo não é medido aqui; os avisos de 70% e 90% valem para as cotas internas (por workspace e por projeto).',
    alternatives: ['Consultar Workers & D1 > Metrics no painel da Cloudflare.', 'Conferir docs/free-tier-limits.md.'],
    inlineNotice: 'Consumo da Cloudflare: veja o painel dela.',
    sourceDoc: 'docs/admin.md',
  },
  {
    id: 'admin-global-por-operador',
    title: 'Admin global só é concedido por um operador',
    status: 'limited',
    reason:
      'Não existe tela nem rota para tornar alguém admin global: isso é feito por quem opera o banco (um comando D1 documentado em docs/admin.md). É proposital: nenhuma falha de aplicação pode promover um usuário.',
    alternatives: ['Seguir o passo a passo de docs/admin.md.'],
    sourceDoc: 'docs/admin.md',
  },
] as const;

export const limitationsById: Record<string, Limitation> = Object.fromEntries(
  limitations.map((l) => [l.id, l]),
);

export const limitationsMeta = { version: '0.8.0', updatedAt: '2026-11-10' } as const;

/** Id de âncora URL-safe. */
export function anchorId(id: string): string {
  return `limitacao-${id}`;
}
