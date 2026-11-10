# Plano de edição (Fase 5)

Para cada corte do projeto, o ContentFlow AI exporta um **plano de edição** que você usa no seu editor (CapCut, Premiere, DaVinci Resolve, Final Cut, Descript). **Nenhum vídeo é cortado, renderizado ou enviado**: o arquivo contém só texto e tempos.

## O que cada entrada tem

| Campo | Origem |
|---|---|
| `index` | posição por ordem de início (1, 2, …) |
| `title`, `notes`, `justification`, `edited` | o corte (sugerido por heurística ou criado à mão, com suas edições) |
| `inMs` / `outMs` / `durationMs` e `inTc` / `outTc` | início e fim do corte; timecode `HH:MM:SS.mmm` |
| `script` e `scriptSource` | falas da transcrição que **tocam** a janela do corte (`transcript`); sem transcrição, o trecho guardado (`excerpt`); sem nada, `none` |

## Formatos

- **TXT** e **MD**: legíveis, com IN/OUT, roteiro por fala com timecode, notas e motivo.
- **CSV** (RFC 4180, CRLF): `index,clip_id,title,in,out,duration_s,in_ms,out_ms,script,script_source,justification,notes,edited`. Células que começam com `= + - @` ganham apóstrofo (proteção contra injeção de fórmula em planilhas).
- **JSON**: `schema: contentflow.edit-plan`, `schemaVersion: 1`, mais o aviso.

O plano é montado **no navegador** a partir de `GET …/export-data` (cortes + transcrição mais recente com timestamps). Não há rota, tabela ou custo novos no servidor.

## Limites que você precisa conhecer

- Os tempos vêm da transcrição. Se você colou um texto e criou cortes à mão, os tempos são os que você digitou; confira na sua mídia.
- O roteiro inclui as falas inteiras que tocam a janela. Quando a borda do corte cai no meio de uma fala, a fala aparece completa.
- Não há taxa de quadros: os tempos são em milissegundos, sem arredondar para frames.
- As sugestões continuam sendo heurística textual (`docs/clips.md`); o plano não analisa áudio, vídeo, emoção nem viralidade.
- Sem corte de vídeo: ver `docs/video-viability.md` (decisão `not_enabled`, status `blocked`).

## Testes

`packages/shared/src/transcript/editplan.test.ts` (ordem, janela, bordas, fallback, escape de CSV, nome de arquivo) e E2E `plano de edição: exporta MD/CSV/TXT/JSON…` (desktop e mobile).
