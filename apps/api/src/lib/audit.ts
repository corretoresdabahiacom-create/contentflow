import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';

export async function audit(
  db: Db,
  e: {
    action: string;
    userId?: string | null;
    workspaceId?: string | null;
    targetKind?: string;
    targetId?: string;
    ipHash?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditLogs).values({
    action: e.action,
    userId: e.userId ?? null,
    workspaceId: e.workspaceId ?? null,
    targetKind: e.targetKind,
    targetId: e.targetId,
    ipHash: e.ipHash ?? null,
    metadataJson: JSON.stringify(e.metadata ?? {}),
  });
}
