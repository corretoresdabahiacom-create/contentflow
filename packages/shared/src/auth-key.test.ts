import { describe, expect, it } from 'vitest';
import { AUTH_KEY_LENGTH, deriveAuthKey, registerSchema } from './index';

describe('deriveAuthKey', () => {
  it('é determinística e tem 43 chars base64url', async () => {
    const a = await deriveAuthKey('A@x.com', 'senha-longa-123', 1000);
    const b = await deriveAuthKey(' a@x.com ', 'senha-longa-123', 1000);
    expect(a).toBe(b);
    expect(a).toHaveLength(AUTH_KEY_LENGTH);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('muda com a senha', async () => {
    expect(await deriveAuthKey('a@x.com', 'um', 1000)).not.toBe(
      await deriveAuthKey('a@x.com', 'dois', 1000),
    );
  });
});

describe('registerSchema', () => {
  it('normaliza e-mail e rejeita authKey inválida', () => {
    const ok = registerSchema.safeParse({
      email: ' A@X.com ',
      authKey: 'a'.repeat(AUTH_KEY_LENGTH),
      turnstileToken: 't',
    });
    expect(ok.success && ok.data.email).toBe('a@x.com');
    expect(
      registerSchema.safeParse({ email: 'a@x.com', authKey: 'curta', turnstileToken: 't' }).success,
    ).toBe(false);
  });
});
