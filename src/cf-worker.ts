import { createConfigManager } from './core/config';
import routes from './api/routes';
import type { ExecutionContext } from '@cloudflare/workers-types';

interface Env {
  OPENAI_BASE_URL?: string;
  AZURE_API_VERSION?: string;
  HOST?: string;
  PORT?: string;
  LOG_LEVEL?: string;
  MAX_TOKENS_LIMIT?: string; 
  MIN_TOKENS_LIMIT?: string;
  REQUEST_TIMEOUT?: string;
  MAX_RETRIES?: string;
  BIG_MODEL?: string;
  MIDDLE_MODEL?: string;
  SMALL_MODEL?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Create config manager with Cloudflare Workers environment
    const configManager = createConfigManager(env);
    
    // @ts-ignore
    globalThis.CONFIG = configManager.config;
    
    return routes.fetch(request, env, ctx);
  }
};