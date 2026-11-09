/** Código de erro do backend -> id em limitations/data.ts (uma fonte, dois pontos de uso). */
export const ERROR_LIMITATION_MAP: Record<string, string> = {
  quota_exceeded: 'quotas-do-plano-gratuito',
  video_render_cap: 'renderizacao-de-video',
  ai_external_disabled: 'ia-externa',
  publish_not_supported: 'publicacao-automatica-em-redes-sociais',
};
