import { z } from 'zod';
import { AUTH_KEY_LENGTH, SUPPORTED_LOCALES } from './constants';

const email = z.string().trim().toLowerCase().email().max(254);
const authKey = z
  .string()
  .length(AUTH_KEY_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/);

export const registerSchema = z.object({
  email,
  authKey,
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.enum(SUPPORTED_LOCALES).default('en'),
  turnstileToken: z.string().min(1).max(2048),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  authKey,
  turnstileToken: z.string().min(1).max(2048),
});
export type LoginInput = z.infer<typeof loginSchema>;

export type PublicUser = { id: string; email: string; displayName: string | null; locale: string; isGlobalAdmin?: boolean };
export type WorkspaceSummary = {
  id: string;
  name: string;
  kind: 'personal' | 'agency';
  role: string;
};
export type MeResponse = { user: PublicUser; workspaces: WorkspaceSummary[] };
export type ApiError = { error: { code: string; message: string; limitation?: string } };
