# Exportação — formato e esquema

Versão do esquema: **1** (`schema: "contentflow.export"`, `schemaVersion: 1`).

O servidor monta o documento (`GET /api/workspaces/:ws/clients/:c/projects/:p/export-data`), registra 1 uso na métrica `exports` (quota mensal `quota.exports_per_month`, padrão 500) e grava `project.export` na auditoria. A serialização para TXT, MD, CSV e JSON roda no navegador (`packages/shared/src/text/export.ts`), então não consome CPU do Worker. Ao atingir a quota o servidor responde `409 quota_exceeded` e nada é exportado.

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
  "outputs": [
    { "id": "…", "channel": "generic", "kind": "title|description|caption|script|article|newsletter|post",
      "title": "…|null", "body": "…", "version": 1, "sourceKind": "template|wasm|ai_external", "updatedAt": 0 }
  ]
}
```
`source` e `analysis` são `null` quando o projeto ainda não tem texto. Na Fase 2 todo `sourceKind` é `template`. Mudanças incompatíveis incrementam `schemaVersion`; campos novos opcionais não.

## CSV
RFC 4180 (CRLF, aspas duplicadas). Colunas: `id,channel,kind,title,body,version,source_kind`. **Proteção contra injeção de fórmula:** células que começam com `=`, `+`, `-`, `@`, TAB ou CR recebem um apóstrofo inicial.

## TXT e MD
Um bloco por output, com tipo, `[sourceKind]` e versão. O MD inclui idioma e palavras-chave da análise. Nomes de arquivo são higienizados (`exportFilename`).
