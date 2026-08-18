import { runtimeConfig } from './config.ts';
import { configuredBackend } from './configured-backend.ts';
import { createBridgeHandler } from './handler.ts';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const config = runtimeConfig(env);
    const handler = createBridgeHandler({
      config,
      backend: configuredBackend(env, config),
    });
    void ctx;
    return await handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
