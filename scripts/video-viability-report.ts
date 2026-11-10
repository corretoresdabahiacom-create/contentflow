/**
 * Lê docs/video-viability-data.csv, avalia H1–H7 (docs/video-viability.md §2) e imprime o relatório (§6) em Markdown.
 *   pnpm report:video                       -> stdout
 *   pnpm report:video --write --by @handle  -> grava docs/video-viability-report.md
 * Sem dados suficientes o resultado é `blocked` / `not_enabled`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateViability, parseViabilityCsv, viabilityMarkdown } from '../packages/shared/src/video/viability';

const csvPath = new URL('../docs/video-viability-data.csv', import.meta.url);
const outPath = new URL('../docs/video-viability-report.md', import.meta.url);
const args = process.argv.slice(2);
const by = args[args.indexOf('--by') + 1] && args.includes('--by') ? (args[args.indexOf('--by') + 1] as string) : 'ninguém (teste não executado)';

const report = evaluateViability(parseViabilityCsv(readFileSync(csvPath, 'utf8')));
const md = `# Relatório de viabilidade — ffmpeg.wasm\n\n_Gerado por \`scripts/video-viability-report.ts\` a partir de \`docs/video-viability-data.csv\`. Observações e recomendação são preenchidas à mão._\n\n${viabilityMarkdown(report, { date: new Date().toISOString().slice(0, 10), by })}`;
if (args.includes('--write')) {
  writeFileSync(outPath, md);
  console.log(`Gravado docs/video-viability-report.md (status ${report.status}, decisão ${report.decision})`);
} else console.log(md);
