# Exportação — formato e esquema

Versão do esquema: **1** (`schema: "contentflow.export"`, `schemaVersion: 1`).

O servidor monta o documento (`GET /api/workspaces/:ws/clients/:c/projects/:p/export-data`), registra 1 uso na métrica `exports` (quota mensal `quota.exports_per_month`, padrão 500) e grava `project.export` na auditoria. A serialização para TXT, MD, SRT, VTT, CSV e JSON roda no navegador (`packages/shared/src/text/export.ts`), então não consome CPU do Worker. Ao atingir a quota o servidor responde `409 quota_exceeded` e nada é exportado.

## JSON

```json
{
  "schema": "contentflow.export",
  "schemaVersion": 1,
  "exportedAt": "2026-11-09T12:00:00.000Z",
  "project": { "id": "…", "name": "…" },
  "client": { "id": "…", "name": "…" },
  "source": { "kind": "paste|txt|md|docx|pdf|csv|json", "filename": "…|null", "chars": 1234 },
  "analysis": { "version": 1, "language": "pt", "keywords": ["…"], "summary": ["…"],
    "stats": { "chars": 0, "words": 0, "sentences": 0 },
    "algorithms": { "language": "franc-min", "keywords": "yake-inspired@1", "summary": "textrank-tfidf@1" } },
  "clips": [ { "id": "…", "startMs": 0, "endMs": 0, "title": "…", "justification": "…", "excerpt": "…", "notes": "…|null", "edited": false, "version": 1 } ],
  "transcript": { "id": "…", "origin": "pasted|srt|vtt|wasm", "language": "pt|null", "segments": [ { "startMs": 0, "endMs": 1500, "text": "…" } ] },
  "outputs": [
    { "id": "…", "channel": "generic|youtube|instagram|tiktok|linkedin|facebook|blog|email", "kind": "title|description|caption|script|article|newsletter|post",
      "title": "…|null", "body": "…", "version": 1, "sourceKind": "template|wasm|ai_external", "updatedAt": 0 }
  ]
}
```
`clips` e `transcript` foram adicionados na Fase 4 como campos opcionais (sem mudar `schemaVersion`); `transcript` é a transcrição mais recente que tem timestamps (ou `null`). `source` e `analysis` são `null` quando o projeto ainda não tem texto. Na Fase 2 todo `sourceKind` é `template`. Mudanças incompatíveis incrementam `schemaVersion`; campos novos opcionais não.

## CSV
RFC 4180 (CRLF, aspas duplicadas). Colunas: `id,channel,kind,title,body,version,source_kind`. **Proteção contra injeção de fórmula:** células que começam com `=`, `+`, `-`, `@`, TAB ou CR recebem um apóstrofo inicial.

## TXT e MD
Um bloco por output, com tipo, `[sourceKind]` e versão. O MD inclui idioma e palavras-chave da análise. Nomes de arquivo são higienizados (`exportFilename`).

## SRT e VTT
Exportam a transcrição com timestamps do projeto (campo `transcript`). O botão fica desabilitado enquanto não houver uma, para não gastar a quota de exportações à toa. VTT usa `.` nos milissegundos e o cabeçalho `WEBVTT`; SRT usa `,` e numera as legendas.

## Canais
Cada saída guarda o `channel`. Os templates por canal (YouTube, Instagram, TikTok, LinkedIn, Facebook, Blog, E-mail) são fixos e rotulados `template`; os limites de caracteres exibidos são aproximados, o texto que passa do limite é sinalizado (nunca cortado em silêncio depois de editado).

## Plano de edição (Fase 5)

O plano de edição por corte é exportado em TXT, MD, CSV e JSON a partir do painel de cortes, com formato próprio (`contentflow.edit-plan`, `schemaVersion` 1). Ver `docs/edit-plan.md`.
