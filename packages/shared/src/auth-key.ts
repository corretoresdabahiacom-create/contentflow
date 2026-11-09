import { CLIENT_KDF_ITERATIONS } from './constants';

const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Deriva a "chave de autenticação" no cliente. A senha em texto nunca sai do navegador.
 * O servidor recebe apenas esta chave (32 bytes, base64url) e guarda um HMAC dela.
 * `iterations` só deve ser reduzido em testes.
 */
export async function deriveAuthKey(
  email: string,
  password: string,
  iterations: number = CLIENT_KDF_ITERATIONS,
): Promise<string> {
  const salt = enc.encode(`contentflow:v1:${email.trim().toLowerCase()}`);
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}
