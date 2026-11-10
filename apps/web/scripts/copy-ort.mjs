// Copia os .wasm do onnxruntime (já empacotados em @xenova/transformers) para public/ort,
// para o navegador buscá-los da mesma origem (sem CDN de terceiros e sem relaxar a CSP de scripts).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('@xenova/transformers/package.json')), 'dist');
const out = join(import.meta.dirname, '..', 'public', 'ort');
mkdirSync(out, { recursive: true });
for (const f of ['ort-wasm-simd.wasm', 'ort-wasm.wasm']) {
  if (!existsSync(join(dist, f))) throw new Error(`arquivo ausente em @xenova/transformers: ${f}`);
  copyFileSync(join(dist, f), join(out, f));
}
