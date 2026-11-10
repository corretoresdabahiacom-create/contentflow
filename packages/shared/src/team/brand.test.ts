import { describe, expect, it } from 'vitest';
import { normalizeColor, validateLogoUrl } from './brand';

describe('validateLogoUrl', () => {
  it('aceita https com domínio', () => expect(validateLogoUrl('https://cdn.exemplo.com/logo.png')).toEqual({ ok: true, url: 'https://cdn.exemplo.com/logo.png' }));
  it.each(['http://exemplo.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', 'https://u:p@exemplo.com/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://intranet/a.png', 'não é url', `https://exemplo.com/${'a'.repeat(500)}`])('recusa %s', (u) => {
    expect(validateLogoUrl(u).ok).toBe(false);
  });
});
describe('normalizeColor', () => {
  it('normaliza para minúsculas e recusa formatos inválidos', () => {
    expect(normalizeColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeColor('red')).toBeNull();
    expect(normalizeColor('#abc')).toBeNull();
    expect(normalizeColor('#aabbccdd')).toBeNull();
  });
});
