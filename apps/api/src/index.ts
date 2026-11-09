import { createApp } from './app';
import type { Env } from './env';
import { cleanup } from './jobs/cleanup';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env.DB));
  },
} satisfies ExportedHandler<Env>;
