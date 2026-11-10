# Transcrição (Fase 3)

O Worker **nunca transcreve** nem recebe áudio. Ele valida o texto/segmentos que o navegador envia, guarda um rascunho, registra os estados do job e, depois da aprovação humana, grava a transcrição. R2 segue excluído (ver `free-tier-limits.md`): o áudio fica no navegador (player local via `blob:` URL) e só texto é persistido.

## Modos
| Modo | Onde roda | `origin` | Observação |
|---|---|---|---|
| Colar texto | navegador → API | `pasted` | principal; sem timestamps; texto editável na revisão |
| Importar `.srt`/`.vtt` | parser no navegador (`packages/shared/src/transcript/subtitles.ts`) | `srt`/`vtt` | segmentos com timestamps; o servidor revalida e deriva o texto dos segmentos |
| WASM no navegador | `@xenova/transformers` (Whisper tiny quantizado) | `wasm` | opcional e experimental, ver abaixo |
| Whisper local (self-host) | fora do SaaS | importa como colar/SRT | `docs/self-host.md`; a plataforma nunca o invoca |

## Máquina de estados (`processing_jobs.status`, kind `transcript`)
```
colada/SRT/VTT:  submitted → validating → waiting_review → completed
WASM:            running → (submit) validating → waiting_review → completed
qualquer estado aberto → canceled      running → failed (erro do navegador) ; validating → failed (resultado inválido)
```
- Transições são atômicas (`UPDATE … WHERE status IN (…)`); ação fora de estado devolve `409 invalid_state`. Duas abas aprovando ao mesmo tempo: só uma passa.
- O rascunho fica em `processing_jobs.payload_json` e é **apagado** ao concluir, cancelar ou falhar. O cron horário cancela jobs abertos há mais de 7 dias (`job.stale_after_s`) e apaga o rascunho.
- Aprovar grava `transcripts` + `transcript_segments`, conta 1 em `usage_records` (`transcripts`, quota 200/mês) e audita `transcript.create`.
- Texto com timestamps não é editável na revisão (editar quebraria a correspondência com os tempos).

## Limites (todos aplicados no servidor e no cliente)
200.000 caracteres; 1.000 segmentos por transcrição (cada segmento é 1 escrita no D1; orçamento 100 mil/dia); 2.000 caracteres por segmento; duração máx. 6 h; 5 jobs abertos por projeto; 200 transcrições por mês e por workspace.

## WASM: requisitos e estado de verificação
Exibidos na UI antes de iniciar: modelo de ~40–80 MB baixado do Hugging Face para o navegador (primeira vez), ~4 GB de RAM, 1–3× a duração do áudio, qualidade baixa em PT/ES, áudio ≤ 10 min, processamento local. **Bloqueio em mobile por padrão** (só com aceite explícito), bloqueio duro para áudio > 10 min, sem WebAssembly ou duração desconhecida; aviso de pouca memória (`navigator.deviceMemory < 4`).

Os `.wasm` do onnxruntime são servidos da própria origem (`/ort/`, copiados de `node_modules` por `apps/web/scripts/copy-ort.mjs`), com `numThreads=1` e `proxy=false` para não precisar de Worker nem de CDN de scripts. A CSP ganhou só `'wasm-unsafe-eval'` em `script-src` e `huggingface.co`/`*.hf.co` em `connect-src`.

**Não verificado:** esta sessão não alcança o Hugging Face, então a transcrição de ponta a ponta **não foi executada**. Testado automaticamente: bloqueios (`wasm.test.ts`), conversão de resultado em segmentos, fluxo de estados no servidor (`submit`/`fail`) e a UI (requisitos, bloqueio mobile). Teste manual necessário em desktop antes de confiar no modo. O build do onnxruntime-web 1.14 emite um aviso de `eval` direto; a CSP não permite `unsafe-eval`, então se esse caminho for exigido em runtime o modo falhará de forma visível (`wasm_failed`) em vez de relaxar a CSP.

## API
Sob `/api/workspaces/:ws/clients/:c/projects/:p`: `GET|POST /transcript-jobs`, `GET /transcript-jobs/:id` (rascunho), `POST …/:id/{submit,fail,cancel,approve}`, `GET /transcripts`, `GET|DELETE /transcripts/:id` (com segmentos). Todas passam pela cadeia `requireAuth → workspace → client → project`; outro tenant recebe 404.
