import { hmacHex, randomToken } from './crypto';

/**
 * O cliente envia uma chave já derivada por PBKDF2 (600k iterações, no navegador).
 * O servidor guarda HMAC-SHA256(pepper, salt:authKey). Custo de CPU desprezível (limite de 10 ms).
 */
export const newSalt = () => randomToken(16);
export const hashAuthKey = (pepper: string, salt: string, authKey: string) =>
  hmacHex(pepper, `${salt}:${authKey}`);
