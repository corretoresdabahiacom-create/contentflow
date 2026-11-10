# Relatório de viabilidade — ffmpeg.wasm

_Gerado por `scripts/video-viability-report.ts` a partir de `docs/video-viability-data.csv`. Observações e recomendação são preenchidas à mão._

## Resultado — vídeo viabilidade

**Data:** 2026-11-10
**Executado por:** ninguém (teste não executado)
**Status:** blocked
**Decisão da Fase 5:** not_enabled

Linhas de dados: 0. Matriz mínima B1 × M1: presentes —; faltando F1, F2, F3.

### Hipóteses

| # | Hipótese | Resultado | Passou |
|---|---|---|---|
| H1 | Chrome desktop ≥ 95% de sucesso (20 execuções) | 0/20 execuções | ⏳ sem dados |
| H2 | Tempo < 3× a duração (mediana e p90) | sem execuções bem-sucedidas | ⏳ sem dados |
| H3 | Pico de memória < 2 GB (vídeo de 3 min) | sem execuções de ~3 min | ⏳ sem dados |
| H4 | Saída reproduzível, áudio sincronizado (3 arquivos × 3 players) | 0/9 avaliações | ⏳ sem dados |
| H5 | Cancelamento limpo (10 tentativas) | 0/10 tentativas | ⏳ sem dados |
| H6 | Firefox desktop ≥ 80% de sucesso _(informativa)_ | 0/20 execuções | ⏳ sem dados |
| H7 | Chrome Android falha de forma segura _(informativa)_ | 0/10 tentativas | ⏳ sem dados |

