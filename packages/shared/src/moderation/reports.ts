/** Motivos aceitos em /report. `illegal` é urgente: o dono não é avisado antes da ação (docs/moderation.md). */
export const REPORT_REASONS = ['illegal', 'copyright', 'privacy', 'abuse', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const URGENT_REASONS: readonly ReportReason[] = ['illegal'];
export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_LIMITS = { details: 2000, contact: 200, link: 400 } as const;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Extrai o token de um link compartilhado (`https://host/s/<token>`, `/s/<token>` ou o token puro).
 * Não valida existência: quem consulta é o servidor (por hash). Devolve null se não parecer um token.
 */
export function extractShareToken(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (TOKEN_RE.test(v)) return v;
  const m = /\/s\/([A-Za-z0-9_-]{20,128})(?:[/?#]|$)/.exec(v);
  return m?.[1] ?? null;
}

/** Limites de ação do admin: só dá para remover (revogar) após avisar o dono, salvo urgência. */
export function canRevoke(r: { urgent: boolean; ownerNotifiedAt: number | null }): boolean {
  return r.urgent || r.ownerNotifiedAt !== null;
}
