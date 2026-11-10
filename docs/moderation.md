# Denúncias e moderação (Fase 7)

## Fluxo
1. **Denúncia pública** em `/report`, sem conta. Campos: link compartilhado (`/s/…`), motivo, detalhes (até 2000), contato opcional. Protegida por Turnstile (falha fechada: sem configuração, o formulário fica indisponível e a API responde 503) e por rate limit por IP (5 por hora, `rate_limit.report.*`).
2. A API responde sempre `201 {received:true}`, exista ou não o link, para não permitir sondagem. Se o link existe, a denúncia aponta para ele e para o workspace dono; o token do link **nunca** é guardado (só o id interno). Motivo `illegal` marca a denúncia como **urgente**.
3. **Fila** (admin global, `/app/admin`, aba Denúncias): urgentes primeiro. O admin vê motivo, detalhes, estado do link e uma **amostra de 200 caracteres** dos outputs que o link já expunha publicamente. Não vê o contato do denunciante, o texto-fonte, transcrições nem outros outputs.
4. **Avisar o dono** (`notify-owner`): cria um aviso in-app para os proprietários do workspace e marca a denúncia como `reviewing`. Pode ser repetido.
5. **Decisão**: arquivar sem ação (`dismiss`) ou **remover = revogar o link** (`revoke_link`). Remover exige (a) o dono ter sido avisado antes, **salvo urgência**, e (b) confirmação explícita (R6: ação irreversível). Os donos recebem um aviso de remoção.
6. Tudo vai para `audit_logs` (`admin.report.*`). Retenção: 180 dias após o encerramento (`report.retention_days`, apagado pelo Cron).

## O que NÃO existe
- Nenhum e-mail é enviado (avisos são in-app, em `/app`).
- Remover não apaga contas, projetos nem outputs do dono; só desativa o link público.
- Denúncia de conteúdo privado não faz sentido: só o que é público por link é denunciável.
- Prazo de 5 dias úteis é compromisso operacional, não automação.
