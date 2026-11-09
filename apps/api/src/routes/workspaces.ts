import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { ERROR_CODES } from '@contentflow/shared';
import type { AppEnv } from '../context';
import { clients, workspaces } from '../db/schema';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { registerContentRoutes } from './content';
import {
  clientContext,
  projectContext,
  requireAuth,
  requireRole,
  workspaceContext,
} from '../middleware';

const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const workspaceRoutes = new Hono<AppEnv>();

// Cadeia obrigatória: user → workspace → client → project (+ requireRole por rota).
workspaceRoutes.use('*', requireAuth);
workspaceRoutes.use('/:workspaceId/*', workspaceContext);
workspaceRoutes.use('/:workspaceId/clients/:clientId/*', clientContext);
workspaceRoutes.use('/:workspaceId/clients/:clientId/projects/:projectId/*', projectContext);

workspaceRoutes.get('/:workspaceId', async (c) => {
  const m = c.get('membership');
  const w = await c
    .get('db')
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, m.workspaceId))
    .get();
  if (!w) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');
  return c.json({ id: w.id, name: w.name, kind: w.kind, role: m.role });
});

workspaceRoutes.patch('/:workspaceId', requireRole('admin'), async (c) => {
  const parsed = renameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, ERROR_CODES.VALIDATION, 'Invalid request body.');
  const db = c.get('db');
  const { workspaceId } = c.get('membership');
  await db
    .update(workspaces)
    .set({ name: parsed.data.name, updatedAt: Date.now() })
    .where(eq(workspaces.id, workspaceId));
  await audit(db, {
    action: 'workspace.rename',
    userId: c.get('user').id,
    workspaceId,
    targetKind: 'workspace',
    targetId: workspaceId,
    ipHash: c.get('ipHash'),
  });
  return c.json({ id: workspaceId, name: parsed.data.name });
});

workspaceRoutes.get('/:workspaceId/clients', async (c) => {
  const rows = await c
    .get('db')
    .select({ id: clients.id, name: clients.name, isImplicit: clients.isImplicit })
    .from(clients)
    .where(eq(clients.workspaceId, c.get('membership').workspaceId))
    .all();
  return c.json({ clients: rows.map((r) => ({ ...r, isImplicit: r.isImplicit === 1 })) });
});

workspaceRoutes.get('/:workspaceId/clients/:clientId', async (c) => {
  return c.json({ id: c.get('clientId'), workspaceId: c.get('membership').workspaceId });
});

// Fase 2: CRUD de clients/projects, source, outputs e export.
registerContentRoutes(workspaceRoutes);
