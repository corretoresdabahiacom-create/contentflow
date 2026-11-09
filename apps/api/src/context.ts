import type { WorkspaceRole } from '@contentflow/shared';
import type { Db } from './db/client';
import type { Env } from './env';

export type AuthUser = { id: string; email: string; isGlobalAdmin: boolean };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    user: AuthUser;
    ipHash: string | null;
    membership: { workspaceId: string; role: WorkspaceRole };
    clientId: string;
    projectId: string;
  };
};

export type Deps = { fetch: typeof fetch };
