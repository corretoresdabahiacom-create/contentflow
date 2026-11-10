# Modelo de dados

Banco: Cloudflare D1 (SQLite). Schema em `apps/api/src/db/schema.ts` (Drizzle); migrações em `apps/api/migrations/` (`pnpm db:generate`). A migração `0001_seed_defaults` insere as feature flags (todas `0`) e os limites padrão em `system_settings`.

Convenções: ids UUID em texto; datas em epoch ms; estados via `CHECK`; `created_at`/`updated_at` em toda tabela (exceto `rate_limit_counters` e `shared_link_outputs`); FKs explícitas com `ON DELETE CASCADE` quando o dado filho não faz sentido sem o pai.

## Propriedade (ownership) e isolamento

| Nível | Chave | Regra |
|---|---|---|
| Usuário | `users.id` | Dono de `sessions`, `user_profiles`, `user_consents`, `notifications`, `sync_state`. |
| Workspace | `workspaces.id` | Tudo que é de conteúdo carrega `workspace_id`. Acesso só via `workspace_members`. Não-membro recebe **404**. |
| Client | `clients.id` | Pertence a exatamente um workspace. `projects`, `content_outputs`, `brand_kits`, `editorial_calendar` e `shared_links` carregam `client_id`. |
| Projeto | `projects.id` | Pertence a um workspace **e** a um client; a rota exige que ambos batam com a URL. |

A cadeia é aplicada pelos middlewares `requireAuth → workspaceContext → clientContext → projectContext` e por `requireRole(min)` (member < admin < owner; papel insuficiente = **403**). Testado em `apps/api/test/isolation.test.ts` e no E2E.

## Tabelas

Identidade: `users`, `user_profiles`, `sessions`. Workspaces: `workspaces`, `workspace_members`, `workspace_invites`, `clients`, `brand_kits`. Projetos e mídia (somente metadados): `projects`, `source_files`, `media_metadata`. Jobs: `processing_jobs`, `processing_job_attempts`. Transcrição: `transcripts`, `transcript_segments`. Conteúdo: `content_outputs` (`version int`, `source_kind` ∈ template|wasm|ai_external), `content_templates`, `clip_suggestions`. Calendário e fluxo: `editorial_calendar`, `approvals`. Compartilhamento: `shared_links`, `shared_link_outputs`, `shared_link_access_logs`. Operação: `notifications`, `reports`, `usage_records`, `usage_quotas`, `rate_limit_counters`, `audit_logs`, `user_consents`, `feature_flags`, `sync_state`, `system_settings`.

## Desvios do §6.1 (decididos e registrados)

- `project_sources` (migração 0002, Fase 2): um texto-fonte por projeto (`kind`, `filename`, `text`, `chars`, `analysis_json`). Substitui o uso de `source_files` enquanto não há storage de arquivos; só o texto extraído é guardado (limite de 200.000 caracteres, bem abaixo dos 2 MB/linha do D1).
- `content_outputs.version` é usada como bloqueio otimista: `PATCH` exige a versão atual e responde `409 version_conflict` se mudou. `source_kind` é sempre definido pelo servidor (`template` na Fase 2); o cliente não escolhe.
- Novas chaves em `system_settings`: `quota.exports_per_month` (500) e `quota.outputs_per_project` (200). Exportações contam em `usage_records` (`metric='exports'`, `period` AAAA-MM).
- `shared_link_outputs` (junção) foi adicionada para guardar quais outputs cada link expõe.
- `rate_limit_counters` vive em **D1**, não em KV (KV Free: 1.000 escritas/dia).
- `source_files.storage_key` é nulo: não há storage de arquivos nesta fase (R2 excluído).
- `sessions` guarda só o **hash** do token e o token anterior por 60 s após rotação.
- Colunas de texto grandes (`transcripts.body_text`) respeitam o limite de 2 MB por linha do D1.

## Fase 3 (migração 0003)
- `processing_jobs` ganhou `payload_json` (rascunho em revisão, apagado ao concluir/cancelar/falhar), `origin` e `transcript_id` (FK `ON DELETE SET NULL`). Jobs de transcrição usam `kind='transcript'`.
- `transcripts.body_text` guarda o texto; `transcript_segments` guarda `idx`, `start_ms`, `end_ms`, `text` (única por `(transcript_id, idx)`). Excluir a transcrição apaga os segmentos (cascade). Índice novo `transcripts(workspace_id)`.
- Novas chaves em `system_settings`: `quota.transcripts_per_month` (200), `quota.active_jobs_per_project` (5), `job.stale_after_s` (604800).

## Fase 4 (migração 0004)
- `clip_suggestions` ganhou `notes`, `version` (bloqueio otimista), `origin` (`heuristic`|`manual`) e `signals_json` (sinais e `heuristicVersion` usados). A tabela não tem `workspace_id`: o isolamento vem de `project_id`, que sempre passa por `projectContext` (e `transcript_id` só pode apontar para transcrição do mesmo projeto e workspace).
- `content_outputs.channel` agora aceita só `generic|youtube|instagram|tiktok|linkedin|facebook|blog|email` (validado na API).
- `GET /transcripts` devolve `segments` (contagem) para a UI saber se há timestamps. Nova chave: `quota.clips_per_project` (100).

## Índices quentes

`workspace_members(workspace_id, user_id)` único; `projects(workspace_id, client_id, created_at)`; `processing_jobs(status, created_at)` e `(status, next_attempt_at)`; `content_outputs(project_id, version)`; `audit_logs(workspace_id, created_at)`; `sessions(token_hash)` único e `(prev_token_hash)`.

## Fase 6 (migração 0005)

- `approvals.output_version` (versão do output no pedido) e índice único parcial `approvals_pending_uq` (um pedido pendente por output).
- `brand_kits_client_uq`: um brand kit por client. `editorial_calendar_client_idx`: calendário por client e data.
- `editorial_calendar.scheduled_for`: data sem horário (meia-noite UTC), ver `docs/team-calendar.md`.
- Configurações novas em `system_settings`: `quota.workspaces_per_user`, `quota.calendar_per_workspace`, `quota.shared_links_per_workspace`, `shared_link.log_retention_days`.
- Tabelas já existentes e agora usadas: `workspace_invites`, `brand_kits`, `editorial_calendar`, `approvals`, `shared_links`, `shared_link_outputs`, `shared_link_access_logs`.

## Fase 7 (migração 0006)
- `reports` ganhou `urgent`, `target_workspace_id`, `owner_notified_at`, `resolution`, `resolution_note`, `reviewer_id`, `reporter_ip_hash` e índice por workspace. `target_kind` é `shared_link` (com `target_id` = id interno do link) ou `unknown`.
- Índice `processing_jobs(status, updated_at)` para achar jobs travados.
- Configurações novas: `rate_limit.report.max/window_s` (5/3600), `report.retention_days` (180), `job.stuck_after_s` (3600).
- `notifications.kind`: `moderation.notice`, `moderation.removed`, `quota.alert`.
