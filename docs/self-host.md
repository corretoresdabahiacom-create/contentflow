# Transcrição local com Whisper (fora do SaaS)

Público: usuário avançado que quer transcrever na própria máquina e importar o resultado. **O ContentFlow AI nunca invoca, acessa, conecta ou controla o Whisper da sua máquina.** Você roda localmente e cola ou envia o resultado. Fluxo: `seu arquivo → seu Whisper local → .srt/.vtt/.txt → colar/importar no ContentFlow AI`. Não há botão "transcrever localmente" no produto.

## Opções
| Opção | Facilidade | Qualidade | Hardware mínimo |
|---|---|---|---|
| A. Ollama | alta | boa | 8 GB RAM, 4 vCPU |
| B. faster-whisper (Python) | média | excelente | 16 GB RAM, GPU opcional |
| C. whisper.cpp | média | boa, muito rápida em CPU | 8 GB RAM, 4 vCPU |

Os comandos exatos mudam por versão; siga a documentação oficial de cada projeto (ollama.com, github.com/SYSTRAN/faster-whisper, github.com/ggerganov/whisper.cpp). Prepare o áudio em WAV 16 kHz mono (`ffmpeg -i entrada.mp4 -ar 16000 -ac 1 -c:a pcm_s16le audio.wav`) e gere `.txt` ou `.srt`. Nota: confirme na documentação do Ollama se há modelo Whisper disponível na sua versão antes de depender dele.

## Qualidade
Informe o idioma quando souber. Para PT/ES use no mínimo o modelo `medium`. Ruído e vários falantes pioram muito o resultado. Revise os timestamps (pode deslizar ±1 s).

## Levar para o ContentFlow AI
Texto: cole a transcrição no projeto. SRT/VTT: importe o arquivo (Fases 2 e 3). Tudo o que o produto faz depois é por template e heurística, sem IA generativa.

## O que o produto nunca fará com o seu setup local
Nunca enviará requisição ao localhost, nunca pedirá chave de API, nunca fará upload automático, nunca exigirá sua máquina ligada, nunca fará streaming do áudio. Se você desinstalar o Whisper amanhã, nada quebra.

Sem suporte oficial a essas ferramentas. Última atualização: 2026-11-09 · Versão 0.1.0
