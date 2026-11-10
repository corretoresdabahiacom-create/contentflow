import { describe, expect, it } from 'vitest';
import { canRevoke, extractShareToken } from './reports';

const T = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ_-abcde';

describe('extractShareToken', () => {
  it('aceita URL completa, caminho e token puro', () => {
    expect(extractShareToken(`https://app.example.com/s/${T}`)).toBe(T);
    expect(extractShareToken(`/s/${T}?x=1`)).toBe(T);
    expect(extractShareToken(`  ${T} `)).toBe(T);
  });
  it('rejeita o que não parece token', () => {
    expect(extractShareToken('')).toBeNull();
    expect(extractShareToken('https://example.com/outra/pagina')).toBeNull();
    expect(extractShareToken('/s/curto')).toBeNull();
  });
});

describe('canRevoke', () => {
  it('exige aviso ao dono, salvo urgência', () => {
    expect(canRevoke({ urgent: false, ownerNotifiedAt: null })).toBe(false);
    expect(canRevoke({ urgent: false, ownerNotifiedAt: 1 })).toBe(true);
    expect(canRevoke({ urgent: true, ownerNotifiedAt: null })).toBe(true);
  });
});
