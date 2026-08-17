import { runtimeConfig } from './config.ts';
import { configuredBackend } from './configured-backend.ts';
import { createBridgeHandler } from './handler.ts';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const handler = createBridgeHandler({
      config: runtimeConfig(env),
      backend: configuredBackend(env),
    });
    void ctx;
    return await handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
