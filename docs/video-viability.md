# Viabilidade de corte de vídeo no navegador (ffmpeg.wasm)

Protocolo de teste empírico que decide a Fase 5: o ContentFlow AI pode oferecer corte de vídeo no navegador como **opt-in experimental**, ou a fase encerra apenas com o **plano de edição exportável**?

> **Regra:** sem este documento preenchido e assinado, a renderização de vídeo não é habilitada. A decisão é binária: `enabled` ou `not_enabled`. Não existe "meio habilitado".

## 0. Estado atual

| Campo | Valor |
|---|---|
| Projeto | ContentFlow AI |
| Versão do documento | 1.0.0 |
| Última execução | **nenhuma** |
| Executado por | — |
| Ambiente de execução | máquina local do testador (nunca o Cloudflare) |
| **Status** | **`blocked`** (o teste não foi executado) |
| **Decisão da Fase 5** | **`not_enabled`** |
| Assinatura humana | pendente |

**Por que `blocked`:** o protocolo exige medições reais que não foram feitas. São 20 execuções por hipótese em Chrome desktop numa máquina de 8 GB / 4 vCPU (B1 × M1) com os arquivos F1–F4, pico de memória medido no DevTools e reprodução da saída em VLC, Chrome e QuickTime. O ambiente de desenvolvimento desta fase (container sem interface gráfica e sem esses arquivos) não é o ambiente exigido em §3. Um benchmark feito lá não valeria como evidência e não foi apresentado como tal.

**Consequências implementadas:**
- `feature_flags.video_render_enabled = 0` (semeado na migração 0001; só um admin global poderia ligar).
- Nenhum código de renderização, nenhuma dependência `@ffmpeg/*` e nenhum botão de corte no produto.
- A UI oferece o **plano de edição** (TXT, MD, CSV, JSON) e as legendas SRT/VTT. Ver `docs/clips.md` e `docs/limitations.md#renderizacao-de-video`.

Para reabrir a decisão: execute §3 numa máquina real, preencha `docs/video-viability-data.csv`, rode `pnpm report:video --write --by @seu-handle`, complete observações e assinatura aqui e só então abra a implementação das restrições de §5 (nova fase, nova aprovação).

## 1. Escopo

Dentro: decodificar, cortar e reempacotar um arquivo de vídeo local no navegador com ffmpeg.wasm (`@ffmpeg/ffmpeg` com `@ffmpeg/core-mt` ou `@ffmpeg/core`); gerar `.mp4` (H.264 + AAC) do trecho; preservar o áudio; sem legenda queimada.

Fora: queimar legenda, redimensionar ou mudar proporção, cortes em paralelo, upload ou transcodificação server-side (impossível no free tier), iOS Safari.

## 2. Hipóteses

| # | Hipótese | Critério de aprovação | Bloqueante |
|---|---|---|---|
| H1 | Chrome desktop corta vídeo ≤ 3 min com sucesso | 20 execuções, ≥ 19 sucessos | sim |
| H2 | Tempo total de corte < 3× a duração | mediana **e** p90 < 3× | sim |
| H3 | Pico de memória durante corte de 3 min | < 2 GB (DevTools) | sim |
| H4 | Saída reproduzível com áudio sincronizado (±200 ms) | 3 players × 3 arquivos, todos ok | sim |
| H5 | UI cancela operação em curso sem travar a aba | 10 cancelamentos, todos limpos | sim |
| H6 | Firefox desktop aceitável | 20 execuções, ≥ 16 sucessos | não |
| H7 | Chrome Android falha de forma segura (erro claro, sem crash) | 10 tentativas, 0 crashes | não |

H1–H5 passam → `enabled` com as restrições de §5. Qualquer um falha → `not_enabled`. Se B1 × M1 falhar, `not_enabled` sem discussão. Dados insuficientes → `blocked`, que também resulta em `not_enabled`.

## 3. Matriz de teste

**Arquivos de entrada**

| ID | Duração | Resolução | Vídeo | Áudio | Bitrate | Origem |
|---|---|---|---|---|---|---|
| F1 | 30 s | 1080p | H.264 | AAC | 8 Mbps | gravado em iPhone 14 |
| F2 | 90 s | 1080p | H.264 | AAC | 12 Mbps | gravado em OBS |
| F3 | 180 s | 1080p | H.264 | AAC | 12 Mbps | gravado em OBS |
| F4 | 180 s | 720p | H.264 | AAC | 4 Mbps | transcodificado com ffmpeg CLI |

Os arquivos ficam fora do repositório (Git LFS ou link público); não usar o R2 do projeto (R1/R2: sem cartão).

**Navegadores:** B1 Chrome desktop 120+ (alvo), B2 Edge 120+, B3 Firefox 120+ (pode exigir `SharedArrayBuffer`), B4 Safari desktop 17+, B5 Chrome Android 120+ (alvo de "falhar de forma segura").

**Máquinas:** M1 modesta (8 GB, 4 vCPU), M2 média (16 GB, 8 vCPU), M3 alta (32 GB, 12+ vCPU).

**Mínimo obrigatório:** B1 × M1 × {F1, F2, F3}. Os demais são registrados como nota.

## 4. Métricas e relatório

Para cada execução, uma linha em `docs/video-viability-data.csv`:

```
browser_id,machine_id,file_id,duration_s,status,wall_time_s,cpu_time_s,peak_ram_mb,output_size_mb,output_plays,audio_sync,cancelled
```

| Coluna | Como medir |
|---|---|
| status | `success` / `failed` / `cancelled` / `crashed` |
| wall_time_s | `performance.now()` antes e depois do `exec` |
| cpu_time_s | `PerformanceObserver` + Profiler do DevTools |
| peak_ram_mb | DevTools → Memory, pico durante a execução |
| output_size_mb | tamanho do arquivo resultante |
| output_plays | `yes`/`no` (VLC + Chrome + QuickTime) |
| audio_sync | `ok`/`desync` (±200 ms) |
| cancelled | `yes` se a linha é uma tentativa de cancelamento (H5) |

`pnpm report:video` lê o CSV, valida o formato, aplica os critérios de §2 (código em `packages/shared/src/video/viability.ts`, com testes) e gera `docs/video-viability-report.md` com a tabela de hipóteses, o status e a decisão. O script nunca dá `enabled` sem os 5 critérios bloqueantes aprovados e sem a matriz mínima.

## 5. Restrições obrigatórias se `enabled`

1. Opt-in explícito por execução (botão "Cortar vídeo (experimental)" com modal de consentimento).
2. Cap de 3 minutos de vídeo de saída; acima disso, erro com link para `docs/limitations.md#renderizacao-de-video`.
3. Cap de 200 MB no arquivo de entrada.
4. Bloqueio em mobile (userAgent + matchMedia), inclusive tablet.
5. Mensagem específica para Safari iOS.
6. Só desktop.
7. Aviso de consumo com estimativa de tempo baseada nas medições.
8. Cancelável: botão sempre visível; cancelar termina o Worker do ffmpeg e libera memória.
9. Sem upload do resultado: o usuário baixa direto.
10. Badge "experimental" em toda a UI e em `docs/limitations.md`.
11. Flag `video_render_enabled` (padrão `false`), ativável só por admin global.
12. Cada execução grava `video_render_attempts` em `usage_records`.
13. Re-teste a cada 90 dias ou a cada release de ffmpeg.wasm; sem re-teste a flag volta a `false`.

Nenhuma dessas restrições está implementada, porque a decisão atual é `not_enabled`.

## 6. Resultado

Ver `docs/video-viability-report.md` (gerado). Resumo atual: **status `blocked`, decisão `not_enabled`**, 0 execuções registradas.

### Observações

- Não há dado experimental. Este documento não afirma que o ffmpeg.wasm é viável nem inviável; afirma que a viabilidade não foi demonstrada, e a regra do briefing é não habilitar sem demonstração.
- Riscos conhecidos a medir quando o teste for feito: `SharedArrayBuffer` exige cabeçalhos COOP/COEP (hoje a CSP não os define, e isso afetaria o resto do app); o core multi-thread pesa dezenas de MB e vem de CDN ou de self-host; cortar sem recodificar (`-c copy`) muda a precisão do corte para o keyframe mais próximo.

### Recomendação

Não habilitar. Usar o plano de edição. Reavaliar quando houver uma máquina M1 disponível para o teste.

## 7. Plano de re-teste

- [ ] A cada 90 dias, repetir B1 × M1 × F1..F3.
- [ ] A cada major de `@ffmpeg/ffmpeg` ou `@ffmpeg/core-mt`.
- [ ] Após mudança em §5 que afete limites.
- [ ] Após alerta de travamento vindo de usuário.

Se H1–H5 falharem em qualquer re-teste, a flag volta a `false`. Registrar aqui data e motivo.

## 8. Checklist de encerramento da Fase 5

- [x] `docs/video-viability.md` com status final (`blocked`).
- [x] `docs/video-viability-data.csv` presente (somente cabeçalho; sem dados).
- [x] `docs/video-viability-report.md` gerado.
- [x] `docs/limitations.md#renderizacao-de-video` atualizado (fase encerrada só com plano de edição).
- [x] `feature_flags.video_render_enabled = 0`, com teste.
- [ ] Assinatura humana pendente.
