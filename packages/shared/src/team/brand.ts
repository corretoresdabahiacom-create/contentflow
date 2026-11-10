/** Validação do brand kit (logo por URL https; não há armazenamento de arquivos). */
export const BRAND_LIMITS = { name: 80, logoUrl: 500, tone: 300 } as const;

/** Só https, sem credenciais embutidas e com host de domínio (sem IP literal nem localhost). */
export function validateLogoUrl(raw: string): { ok: true; url: string } | { ok: false } {
  if (raw.length > BRAND_LIMITS.logoUrl) return { ok: false };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false };
  }
  const host = u.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (u.protocol !== 'https:' || u.username || u.password || !host.includes('.') || isIp || host === 'localhost' || host.endsWith('.localhost')) return { ok: false };
  return { ok: true, url: u.toString() };
}

export const normalizeColor = (c: string): string | null => (/^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null);
