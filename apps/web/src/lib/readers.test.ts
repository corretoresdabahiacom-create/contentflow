import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXT_MAX_CHARS } from '@contentflow/shared';
import { jsonStrings, kindFromFilename, readSourceFile, ReaderError, type FileLike } from './readers';

const mem = (name: string, content: string | Uint8Array): FileLike => {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.byteLength,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
};
const fixture = (n: string) => mem(n, new Uint8Array(readFileSync(join(__dirname, 'fixtures', n))));
const fails = (p: Promise<unknown>, code: string) =>
  p.then(
    () => { throw new Error('should fail'); },
    (e) => { expect(e).toBeInstanceOf(ReaderError); expect((e as ReaderError).code).toBe(code); },
  );

describe('readers', () => {
  it('detecta tipos suportados e rejeita o resto', async () => {
    expect(kindFromFilename('a.TXT')).toBe('txt');
    expect(kindFromFilename('a.markdown')).toBe('md');
    expect(kindFromFilename('a.exe')).toBeNull();
    await fails(readSourceFile(mem('a.pptx', 'x')), 'unsupported');
  });
  it('txt/md/csv: normaliza BOM e quebras de linha', async () => {
    expect((await readSourceFile(mem('a.txt', '﻿olá\r\nmundo\r\n'))).text).toBe('olá\nmundo');
    expect((await readSourceFile(mem('a.csv', 'a,b\n1,2'))).kind).toBe('csv');
  });
  it('json: extrai só os valores string', async () => {
    expect(jsonStrings({ a: 'x', b: [1, 'y', { c: 'z' }], d: null })).toEqual(['x', 'y', 'z']);
    expect((await readSourceFile(mem('a.json', '{"t":"um","u":["dois"]}'))).text).toBe('um\ndois');
    await fails(readSourceFile(mem('a.json', '{oops')), 'invalid_json');
  });
  it('arquivo vazio, grande demais e texto longo demais', async () => {
    await fails(readSourceFile(mem('a.txt', '   ')), 'empty');
    await fails(readSourceFile({ ...mem('a.txt', 'x'), size: 11 * 1024 * 1024 }), 'too_large');
    await fails(readSourceFile(mem('a.txt', 'x'.repeat(TEXT_MAX_CHARS + 1))), 'too_long');
  });
  it('docx real (mammoth)', async () => {
    const r = await readSourceFile(fixture('sample.docx'));
    expect(r.kind).toBe('docx');
    expect(r.text).toContain('painéis solares');
  });
  it('pdf real (unpdf) e pdf sem texto => no_text (sem OCR)', async () => {
    expect((await readSourceFile(fixture('sample.pdf'))).text).toContain('Solar panels');
    await fails(readSourceFile(fixture('blank.pdf')), 'no_text');
  });
  it('docx/pdf corrompidos => parse_failed', async () => {
    await fails(readSourceFile(mem('a.docx', 'not a zip')), 'parse_failed');
    await fails(readSourceFile(mem('a.pdf', 'not a pdf')), 'parse_failed');
  });
});
