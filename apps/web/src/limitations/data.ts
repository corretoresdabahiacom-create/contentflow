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
      'Edição de vídeo exige ffmpeg e CPU/GPU além do que a infraestrutura gratuita permite no servidor.',
    alternatives: [
      'Exportar um plano de edição com timestamps e roteiro.',
      'Exportar legendas em .srt/.vtt.',
      'Se o teste de viabilidade passar: corte experimental no navegador (opt-in, até 3 min, apenas desktop).',
    ],
    inlineNotice: 'Vídeo final não é renderizado por padrão.',
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
    id: 'denuncias-e-moderacao',
    title: 'Denúncias e moderação',
    status: 'limited',
    reason: 'Denúncias são tratadas manualmente pela administração.',
    alternatives: ['Enviar denúncia em /report.', 'Prazo de resposta: até 5 dias úteis.'],
  },
] as const;

export const limitationsById: Record<string, Limitation> = Object.fromEntries(
  limitations.map((l) => [l.id, l]),
);

export const limitationsMeta = { version: '0.4.0', updatedAt: '2026-11-09' } as const;

/** Id de âncora URL-safe. */
export function anchorId(id: string): string {
  return `limitacao-${id}`;
}
