// Gera docs/limitations.md a partir de apps/web/src/limitations/data.ts.
// Com --check, falha (exit 1) se o .md commitado diferir do gerado.
import { readFileSync, writeFileSync } from 'node:fs';
import { anchorId, limitations, limitationsMeta } from '../apps/web/src/limitations/data';

const STATUS_LABEL = {
  not_available: 'Indisponível',
  limited: 'Limitado',
  experimental: 'Experimental',
} as const;

const lines: string[] = [];
lines.push('# Limitações do ContentFlow AI', '');
lines.push(
  '> Documento público, gerado a partir de `apps/web/src/limitations/data.ts`. **Não edite este arquivo diretamente.** Rode `pnpm gen:limitations`.',
  '',
);
lines.push(
  `**Versão:** ${limitationsMeta.version} · **Última atualização:** ${limitationsMeta.updatedAt}`,
  '',
);
lines.push('## Sumário', '');
for (const l of limitations)
  lines.push(`- [${l.title}](#${anchorId(l.id)}) — _${STATUS_LABEL[l.status]}_`);
lines.push('');

for (const l of limitations) {
  lines.push(
    `<a id="${anchorId(l.id)}"></a>`,
    '',
    `## ${l.title}`,
    '',
    `**Status:** ${STATUS_LABEL[l.status]}`,
    '',
    l.reason,
    '',
  );
  if (l.quotas?.length) {
    lines.push('| Item | Valor |', '|---|---|');
    for (const q of l.quotas) lines.push(`| ${q.label} | ${q.value} |`);
    lines.push('');
  }
  if (l.alternatives.length) {
    lines.push('**O que você pode fazer:**', '');
    for (const a of l.alternatives) lines.push(`- ${a}`);
    lines.push('');
  }
  if (l.related?.length) {
    const links = l.related
      .map((rid) => limitations.find((x) => x.id === rid))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => `[${r.title}](#${anchorId(r.id)})`);
    lines.push(`**Ver também:** ${links.join(', ')}`, '');
  }
  if (l.sourceDoc) lines.push(`_Referência interna:_ \`${l.sourceDoc}\``, '');
}

const out = lines.join('\n').trim() + '\n';
const path = 'docs/limitations.md';

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    /* ausente */
  }
  if (current.trim() !== out.trim()) {
    console.error('docs/limitations.md está desatualizado. Rode `pnpm gen:limitations`.');
    process.exit(1);
  }
  console.log('docs/limitations.md sincronizado.');
} else {
  writeFileSync(path, out, 'utf8');
  console.log(`Gerado ${path} (${limitations.length} limitações).`);
}
