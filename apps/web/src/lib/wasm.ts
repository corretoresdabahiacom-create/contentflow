import type { Segment } from '@contentflow/shared';

/** Whisper no navegador (opcional, experimental). Nada disso roda no Worker. */
export const WASM_MODEL = 'Xenova/whisper-tiny'; // quantizado; qualidade baixa em PT/ES
export const WASM_MAX_SECONDS = 10 * 60;
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.ogg,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg';
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg'] as const;

export type GateInput = {
  mobile: boolean;
  deviceMemoryGb?: number; // navigator.deviceMemory (Chrome/Edge; ausente em Safari/Firefox)
  durationSec: number | null;
  hasWasm: boolean;
  hasAudioContext: boolean;
};
export type GateReason = 'mobile' | 'low_memory' | 'too_long' | 'duration_unknown' | 'no_wasm' | 'no_audio_context';
export type Gate = {
  /** Impedimentos que nenhuma confirmação do usuário remove. */
  blocked: GateReason[];
  /** Avisos que o usuário pode aceitar explicitamente (mobile fica bloqueado por padrão). */
  overridable: GateReason[];
};

export function wasmGate(i: GateInput): Gate {
  const blocked: GateReason[] = [];
  const overridable: GateReason[] = [];
  if (!i.hasWasm) blocked.push('no_wasm');
  if (!i.hasAudioContext) blocked.push('no_audio_context');
  if (i.durationSec === null) blocked.push('duration_unknown');
  else if (i.durationSec > WASM_MAX_SECONDS) blocked.push('too_long');
  if (i.mobile) overridable.push('mobile');
  if (i.deviceMemoryGb !== undefined && i.deviceMemoryGb < 4) overridable.push('low_memory');
  return { blocked, overridable };
}

export const canRunWasm = (g: Gate, accepted: boolean) =>
  g.blocked.length === 0 && (g.overridable.length === 0 || accepted);

export function isMobile(ua: string, touchPoints = 0): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/** Estimativas grosseiras e rotuladas como tal na UI. */
export function wasmEstimate(durationSec: number) {
  return {
    downloadMb: [40, 80] as const, // primeira vez; depois fica no cache do navegador
    minutes: [Math.max(1, Math.round(durationSec / 60)), Math.max(2, Math.round((durationSec / 60) * 3))] as const,
    ramGb: 4,
  };
}

export const audioExtOk = (name: string) =>
  (AUDIO_EXTENSIONS as readonly string[]).includes(name.toLowerCase().split('.').pop() ?? '');

type Chunk = { text: string; timestamp: [number | null, number | null] };
export function chunksToSegments(chunks: readonly Chunk[], durationSec: number): Segment[] {
  const out: Segment[] = [];
  let prevStart = 0; // validateSegments exige início não decrescente
  for (const c of chunks) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Math.max(prevStart, Math.round((c.timestamp[0] ?? prevStart / 1000) * 1000));
    const end = Math.max(start, Math.round((c.timestamp[1] ?? durationSec) * 1000));
    out.push({ startMs: start, endMs: end, text: text.slice(0, 2000) });
    prevStart = start;
  }
  return out;
}

export class WasmError extends Error {
  constructor(public code: 'wasm_unsupported' | 'wasm_download_failed' | 'wasm_out_of_memory' | 'wasm_failed' | 'user_aborted') {
    super(code);
  }
}

async function decode16kMono(file: File): Promise<{ samples: Float32Array; durationSec: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const frames = Math.ceil(buf.duration * 16_000);
    const off = new OfflineAudioContext(1, frames, 16_000);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return { samples: rendered.getChannelData(0), durationSec: buf.duration };
  } finally {
    void ctx.close();
  }
}

/**
 * Transcreve localmente. Carrega a biblioteca e o modelo só aqui (lazy). O modelo vem do Hugging Face
 * para o navegador do usuário; o arquivo de áudio nunca é enviado a lugar nenhum.
 * Não executado nesta sessão de desenvolvimento (sem acesso ao Hugging Face): ver docs/limitations.md.
 */
export async function transcribeWasm(
  file: File,
  language: 'pt' | 'en' | 'es',
  onStatus: (s: 'loading_model' | 'decoding' | 'transcribing') => void,
  signal?: AbortSignal,
): Promise<Segment[]> {
  let decoded: Awaited<ReturnType<typeof decode16kMono>>;
  onStatus('decoding');
  try {
    decoded = await decode16kMono(file);
  } catch {
    throw new WasmError('wasm_failed');
  }
  if (signal?.aborted) throw new WasmError('user_aborted');

  onStatus('loading_model');
  let pipe: (a: Float32Array, o: Record<string, unknown>) => Promise<{ chunks?: Chunk[]; text: string } | { chunks?: Chunk[]; text: string }[]>;
  try {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = '/ort/'; // mesma origem; ver scripts/copy-ort.mjs
    env.backends.onnx.wasm.numThreads = 1; // sem Worker extra: a CSP de scripts continua restrita
    env.backends.onnx.wasm.proxy = false;
    pipe = (await pipeline('automatic-speech-recognition', WASM_MODEL, { quantized: true })) as unknown as typeof pipe;
  } catch (e) {
    throw new WasmError(/memory|alloc/i.test(String(e)) ? 'wasm_out_of_memory' : 'wasm_download_failed');
  }
  if (signal?.aborted) throw new WasmError('user_aborted');

  onStatus('transcribing');
  try {
    const raw = await pipe(decoded.samples, { language: { pt: 'portuguese', en: 'english', es: 'spanish' }[language], task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const r = Array.isArray(raw) ? raw[0] : raw;
    const segs = chunksToSegments(r?.chunks ?? [], decoded.durationSec);
    if (segs.length) return segs;
    if (r?.text?.trim()) return [{ startMs: 0, endMs: Math.round(decoded.durationSec * 1000), text: r.text.trim().slice(0, 2000) }];
    throw new WasmError('wasm_failed');
  } catch (e) {
    if (e instanceof WasmError) throw e;
    throw new WasmError(/memory|alloc/i.test(String(e)) ? 'wasm_out_of_memory' : 'wasm_failed');
  }
}
