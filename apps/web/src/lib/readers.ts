import { TEXT_MAX_CHARS } from '@contentflow/shared';

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // lido só no navegador; nada é enviado como arquivo
export type FileKind = 'txt' | 'md' | 'docx' | 'pdf' | 'csv' | 'json';
export const ACCEPT = '.txt,.md,.markdown,.docx,.pdf,.csv,.json';

export type ReaderErrorCode =
  | 'unsupported'
  | 'too_large'
  | 'empty'
  | 'invalid_json'
  | 'no_text'
  | 'too_long'
  | 'parse_failed';
export class ReaderError extends Error {
  constructor(public code: ReaderErrorCode) {
    super(code);
  }
}

export type FileLike = {
  name: string;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function kindFromFilename(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'markdown') return 'md';
  return (['txt', 'md', 'docx', 'pdf', 'csv', 'json'] as const).find((k) => k === ext) ?? null;
}

/** Extrai todos os valores string de um JSON (chaves são ignoradas). */
export function jsonStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) jsonStrings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonStrings(x, out);
  return out;
}

const normalize = (s: string) => s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();

export async function readSourceFile(file: FileLike): Promise<{ kind: FileKind; filename: string; text: string }> {
  const kind = kindFromFilename(file.name);
  if (!kind) throw new ReaderError('unsupported');
  if (file.size > MAX_FILE_BYTES) throw new ReaderError('too_large');

  let raw: string;
  try {
    if (kind === 'docx') {
      const mammoth = await import('mammoth');
      raw = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    } else if (kind === 'pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      raw = (await extractText(pdf, { mergePages: true })).text;
    } else if (kind === 'json') {
      try {
        raw = jsonStrings(JSON.parse(await file.text())).join('\n');
      } catch {
        throw new ReaderError('invalid_json');
      }
    } else {
      raw = await file.text();
    }
  } catch (e) {
    if (e instanceof ReaderError) throw e;
    throw new ReaderError('parse_failed');
  }
  const text = normalize(raw);
  if (!text) throw new ReaderError(kind === 'pdf' || kind === 'docx' ? 'no_text' : 'empty');
  if (text.length > TEXT_MAX_CHARS) throw new ReaderError('too_long');
  return { kind, filename: file.name, text };
}
