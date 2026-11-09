import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// Convenções: ids = UUID (texto); datas = epoch em ms (integer); estados via CHECK;
// toda tabela tem created_at/updated_at. Propriedade/ownership em docs/data-model.md.
const NOW = sql`(cast(unixepoch('subsec') * 1000 as integer))`;
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ts = () => ({
  createdAt: integer('created_at').notNull().default(NOW),
  updatedAt: integer('updated_at').notNull().default(NOW),
});
const bool = (name: string) => integer(name).notNull().default(0);

// ---------- identidade ----------
export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordSalt: text('password_salt').notNull(),
    status: text('status').notNull().default('active'),
    isGlobalAdmin: bool('is_global_admin'),
    ...ts(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    check('users_status_ck', sql`${t.status} in ('active','suspended')`),
  ],
);

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('en'),
  theme: text('theme').notNull().default('system'),
  ...ts(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    // Token anterior continua válido por 60 s após a rotação (requisições em voo não caem).
    prevTokenHash: text('prev_token_hash'),
    prevValidUntil: integer('prev_valid_until'),
    expiresAt: integer('expires_at').notNull(),
    rotatedAt: integer('rotated_at').notNull().default(NOW),
    userAgent: text('user_agent'),
    ...ts(),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_prev_token_idx').on(t.prevTokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------- workspace / clients ----------
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('personal'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id),
    ...ts(),
  },
  (t) => [
    index('workspaces_owner_idx').on(t.ownerUserId),
    check('workspaces_kind_ck', sql`${t.kind} in ('personal','agency')`),
  ],
);

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    ...ts(),
  },
  (t) => [
    uniqueIndex('workspace_members_ws_user_uq').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
    check('workspace_members_role_ck', sql`${t.role} in ('owner','admin','member')`),
  ],
);

export const workspaceInvites = sqliteTable(
  'workspace_invites',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    role: text('role').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    acceptedAt: integer('accepted_at'),
    revokedAt: integer('revoked_at'),
    ...ts(),
  },
  (t) => [
    uniqueIndex('workspace_invites_token_uq').on(t.tokenHash),
    index('workspace_invites_ws_idx').on(t.workspaceId),
    check('workspace_invites_role_ck', sql`${t.role} in ('admin','member')`),
  ],
);

export const clients = sqliteTable(
  'clients',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isImplicit: bool('is_implicit'), // cliente "eu" do workspace pessoal
    ...ts(),
  },
  (t) => [index('clients_ws_idx').on(t.workspaceId)],
);

export const brandKits = sqliteTable(
  'brand_kits',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color'),
    tone: text('tone'),
    ...ts(),
  },
  (t) => [index('brand_kits_client_idx').on(t.clientId)],
);

// ---------- projetos e mídia (metadados) ----------
export const projects = sqliteTable(
  'projects',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...ts(),
  },
  (t) => [
    index('projects_ws_client_created_idx').on(t.workspaceId, t.clientId, t.createdAt),
    check('projects_status_ck', sql`${t.status} in ('active','archived')`),
  ],
);

// R2 excluído em 2026-11-09: storage_key fica nulo até um storage sem cartão ser verificado.
export const sourceFiles = sqliteTable(
  'source_files',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key'),
    retain: bool('retain'),
    status: text('status').notNull().default('pending'),
    ...ts(),
  },
  (t) => [
    index('source_files_project_idx').on(t.projectId),
    index('source_files_ws_idx').on(t.workspaceId),
    check('source_files_status_ck', sql`${t.status} in ('pending','ready','deleted')`),
  ],
);

export const mediaMetadata = sqliteTable(
  'media_metadata',
  {
    id: id(),
    sourceFileId: text('source_file_id')
      .notNull()
      .references(() => sourceFiles.id, { onDelete: 'cascade' }),
    durationMs: integer('duration_ms'),
    declaredMime: text('declared_mime'),
    detectedMime: text('detected_mime'),
    ...ts(),
  },
  (t) => [uniqueIndex('media_metadata_file_uq').on(t.sourceFileId)],
);

// ---------- jobs ----------
export const processingJobs = sqliteTable(
  'processing_jobs',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('submitted'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
    errorCode: text('error_code'),
    ...ts(),
  },
  (t) => [
    index('processing_jobs_status_created_idx').on(t.status, t.createdAt),
    index('processing_jobs_next_attempt_idx').on(t.status, t.nextAttemptAt),
    index('processing_jobs_project_idx').on(t.projectId),
    check(
      'processing_jobs_status_ck',
      sql`${t.status} in ('submitted','validating','waiting_review','running','completed','failed','canceled')`,
    ),
  ],
);

export const processingJobAttempts = sqliteTable(
  'processing_job_attempts',
  {
    id: id(),
    jobId: text('job_id')
      .notNull()
      .references(() => processingJobs.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    startedAt: integer('started_at').notNull().default(NOW),
    finishedAt: integer('finished_at'),
    outcome: text('outcome'),
    error: text('error'),
    ...ts(),
  },
  (t) => [uniqueIndex('job_attempts_job_no_uq').on(t.jobId, t.attemptNo)],
);

// ---------- transcrições ----------
export const transcripts = sqliteTable(
  'transcripts',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    language: text('language'),
    bodyText: text('body_text').notNull(), // limite de 2 MB por linha no D1 (docs/free-tier-limits.md)
    ...ts(),
  },
  (t) => [
    index('transcripts_project_idx').on(t.projectId),
    check('transcripts_origin_ck', sql`${t.origin} in ('pasted','srt','vtt','wasm')`),
  ],
);

export const transcriptSegments = sqliteTable(
  'transcript_segments',
  {
    id: id(),
    transcriptId: text('transcript_id')
      .notNull()
      .references(() => transcripts.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    ...ts(),
  },
  (t) => [
    uniqueIndex('transcript_segments_idx_uq').on(t.transcriptId, t.idx),
    check('transcript_segments_range_ck', sql`${t.endMs} >= ${t.startMs}`),
  ],
);

// Fase 2: texto-fonte de um projeto (um por projeto). Só texto; arquivos são lidos no navegador.
export const projectSources = sqliteTable(
  'project_sources',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    filename: text('filename'),
    text: text('text').notNull(),
    chars: integer('chars').notNull(),
    analysisJson: text('analysis_json'),
    ...ts(),
  },
  (t) => [
    index('project_sources_ws_idx').on(t.workspaceId),
    check('project_sources_kind_ck', sql`${t.kind} in ('paste','txt','md','docx','pdf','csv','json')`),
  ],
);

// ---------- conteúdo ----------
export const contentOutputs = sqliteTable(
  'content_outputs',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    title: text('title'),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    sourceKind: text('source_kind').notNull().default('template'),
    status: text('status').notNull().default('draft'),
    ...ts(),
  },
  (t) => [
    index('content_outputs_project_version_idx').on(t.projectId, t.version),
    index('content_outputs_ws_idx').on(t.workspaceId),
    check('content_outputs_source_ck', sql`${t.sourceKind} in ('template','wasm','ai_external')`),
    check('content_outputs_version_ck', sql`${t.version} >= 1`),
  ],
);

export const contentTemplates = sqliteTable(
  'content_templates',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    locale: text('locale').notNull().default('en'),
    body: text('body').notNull(),
    ...ts(),
  },
  (t) => [index('content_templates_channel_idx').on(t.channel, t.kind, t.locale)],
);

export const clipSuggestions = sqliteTable(
  'clip_suggestions',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    transcriptId: text('transcript_id').references(() => transcripts.id, { onDelete: 'set null' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    title: text('title').notNull(),
    justification: text('justification').notNull(),
    excerpt: text('excerpt').notNull(),
    edited: bool('edited'),
    ...ts(),
  },
  (t) => [
    index('clip_suggestions_project_idx').on(t.projectId),
    check('clip_suggestions_range_ck', sql`${t.endMs} > ${t.startMs}`),
  ],
);

// ---------- calendário / aprovações / compartilhamento ----------
export const editorialCalendar = sqliteTable(
  'editorial_calendar',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    outputId: text('output_id').references(() => contentOutputs.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    scheduledFor: integer('scheduled_for'),
    status: text('status').notNull().default('idea'),
    assigneeUserId: text('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    ...ts(),
  },
  (t) => [
    index('editorial_calendar_ws_date_idx').on(t.workspaceId, t.scheduledFor),
    index('editorial_calendar_assignee_idx').on(t.assigneeUserId),
    check(
      'editorial_calendar_status_ck',
      sql`${t.status} in ('idea','producing','review','approved','scheduled','published')`,
    ),
  ],
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    outputId: text('output_id')
      .notNull()
      .references(() => contentOutputs.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id),
    decidedBy: text('decided_by').references(() => users.id),
    status: text('status').notNull().default('pending'),
    note: text('note'),
    decidedAt: integer('decided_at'),
    ...ts(),
  },
  (t) => [
    index('approvals_output_idx').on(t.outputId),
    check('approvals_status_ck', sql`${t.status} in ('pending','approved','rejected')`),
  ],
);

export const sharedLinks = sqliteTable(
  'shared_links',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    ...ts(),
  },
  (t) => [
    uniqueIndex('shared_links_token_uq').on(t.tokenHash),
    index('shared_links_ws_idx').on(t.workspaceId),
  ],
);

// Desvio documentado do §6.1: tabela de junção para "apenas outputs selecionados".
export const sharedLinkOutputs = sqliteTable(
  'shared_link_outputs',
  {
    linkId: text('link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    outputId: text('output_id')
      .notNull()
      .references(() => contentOutputs.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.linkId, t.outputId] })],
);

export const sharedLinkAccessLogs = sqliteTable(
  'shared_link_access_logs',
  {
    id: id(),
    linkId: text('link_id')
      .notNull()
      .references(() => sharedLinks.id, { onDelete: 'cascade' }),
    accessedAt: integer('accessed_at').notNull().default(NOW),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    ...ts(),
  },
  (t) => [index('shared_link_logs_link_idx').on(t.linkId, t.accessedAt)],
);

// ---------- notificações / denúncias ----------
export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    readAt: integer('read_at'),
    ...ts(),
  },
  (t) => [index('notifications_user_read_idx').on(t.userId, t.readAt)],
);

export const reports = sqliteTable(
  'reports',
  {
    id: id(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id'),
    reason: text('reason').notNull(),
    details: text('details'),
    reporterContact: text('reporter_contact'),
    status: text('status').notNull().default('open'),
    resolvedAt: integer('resolved_at'),
    ...ts(),
  },
  (t) => [
    index('reports_status_idx').on(t.status, t.createdAt),
    check('reports_status_ck', sql`${t.status} in ('open','reviewing','resolved','dismissed')`),
  ],
);

// ---------- uso / limites ----------
export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    amount: integer('amount').notNull().default(1),
    period: text('period').notNull(), // AAAA-MM
    overThreshold: bool('over_threshold'),
    ...ts(),
  },
  (t) => [index('usage_records_ws_metric_period_idx').on(t.workspaceId, t.metric, t.period)],
);

export const usageQuotas = sqliteTable(
  'usage_quotas',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    limitValue: integer('limit_value').notNull(),
    ...ts(),
  },
  (t) => [uniqueIndex('usage_quotas_ws_metric_uq').on(t.workspaceId, t.metric)],
);

// Rate limit em D1 (KV descartado: 1.000 escritas/dia no Free).
export const rateLimitCounters = sqliteTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limit_window_idx').on(t.windowStart),
  ],
);

// ---------- auditoria / consentimento / config ----------
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    workspaceId: text('workspace_id'),
    userId: text('user_id'),
    action: text('action').notNull(),
    targetKind: text('target_kind'),
    targetId: text('target_id'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    ipHash: text('ip_hash'),
    ...ts(),
  },
  (t) => [
    index('audit_logs_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('audit_logs_user_idx').on(t.userId, t.createdAt),
  ],
);

export const userConsents = sqliteTable(
  'user_consents',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    grantedAt: integer('granted_at').notNull().default(NOW),
    revokedAt: integer('revoked_at'),
    ...ts(),
  },
  (t) => [index('user_consents_user_kind_idx').on(t.userId, t.kind)],
);

export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: bool('enabled'),
  description: text('description'),
  ...ts(),
});

export const syncState = sqliteTable(
  'sync_state',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    entity: text('entity').notNull(),
    lastVersion: integer('last_version').notNull().default(0),
    ...ts(),
  },
  (t) => [uniqueIndex('sync_state_user_device_entity_uq').on(t.userId, t.deviceId, t.entity)],
);

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  ...ts(),
});
