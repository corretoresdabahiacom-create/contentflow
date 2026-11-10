# Sugestões de cortes (Fase 4)

Heurística **textual** determinística (`packages/shared/src/transcript/clips.ts`, versão 1), executada no navegador sobre os segmentos com timestamps de uma transcrição. O servidor valida e persiste (`clip_suggestions`); não calcula nada. Exige timestamps (.srt/.vtt ou modo WASM); texto colado sem tempos não gera cortes.

## Sinais (todos visíveis na justificativa de cada corte)
1. **Mudança de assunto:** cosseno TF-IDF entre a janela anterior e a seguinte (4 segmentos) em cada fronteira; a fronteira vira ponto de corte se for mínimo local e estiver abaixo de `média − 0,5·desvio`. A justificativa mostra a similaridade.
2. **Pausa longa** (≥ 2 s) entre segmentos.
3. **Padrões de impacto** dentro do trecho: pergunta (`?`/`¿`), frase no imperativo (lista curta de verbos por idioma), números, citação entre aspas, palavras-chave do texto inteiro (YAKE-inspired).
4. **Bordas** sempre em início/fim de segmento. Duração padrão 15–90 s (spans longos são quebrados, curtos são unidos). No máximo 8 sugestões, ordenadas no tempo.

Palavra-chave sozinha não basta: é preciso ao menos um sinal estrutural. Sem sinais, o produto diz que não achou nada em vez de inventar cortes.

## O que não faz
Não analisa áudio nem vídeo; **não detecta emoção, expressão facial, tom de voz nem potencial de viralização**, e a UI e os testes impedem esse vocabulário nas justificativas. A pontuação (`score`) só ordena por quantidade de sinais, não prevê desempenho.

## Edição e persistência
Cada corte tem título, início/fim (m:ss), notas, `origin` (`heuristic`|`manual`), `edited` e `version` (bloqueio otimista, 409 em conflito). **Regenerar** substitui apenas sugestões automáticas ainda não editadas; cortes manuais ou editados nunca são apagados. Limite: 100 cortes por projeto. O plano de edição exportável por corte (roteiro, notas, timestamps) é a Fase 5; hoje os cortes saem no JSON, MD e TXT da exportação.
