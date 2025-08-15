import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { v4 as uuidv4 } from 'uuid';

import { logger } from './core/logger';
import { TokenCounter, ApiKeyExtractor } from './core/shared-utils';
import { OpenAIClient } from './core/client';
import { modelManager } from './core/model-manager';
import { ClaudeMessagesRequest, ClaudeTokenCountRequest } from './models/claude';
import { convertClaudeToOpenAI } from './conversion/request-converter';
import {
  convertOpenAIToClaudeResponse,
  convertOpenAIStreamingToClaudeWithCancellation
} from './conversion/response-converter';

// Cloudflare Worker environment interface
export interface Env {
  OPENAI_BASE_URL?: string;
  BIG_MODEL?: string;
  MIDDLE_MODEL?: string;
  SMALL_MODEL?: string;
  MAX_TOKENS_LIMIT?: string;
  MIN_TOKENS_LIMIT?: string;
  REQUEST_TIMEOUT?: string;
  LOG_LEVEL?: string;
  AZURE_API_VERSION?: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
}));

// Configuration helper
const getConfig = (env: Env) => ({
  openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  bigModel: env.BIG_MODEL || 'openai/gpt-oss-120b',
  middleModel: env.MIDDLE_MODEL || 'openai/gpt-oss-120b',
  smallModel: env.SMALL_MODEL || 'gpt-oss-20b',
  maxTokensLimit: parseInt(env.MAX_TOKENS_LIMIT || '4096'),
  minTokensLimit: parseInt(env.MIN_TOKENS_LIMIT || '100'),
  requestTimeout: parseInt(env.REQUEST_TIMEOUT || '90'),
  azureApiVersion: env.AZURE_API_VERSION || '2024-02-01',
  logLevel: env.LOG_LEVEL || 'WARNING'
});

// Middleware to handle 413 errors gracefully and validate request size
app.use('/v1/*', async (c, next) => {
  const requestId = uuidv4();
  logger.info(`[${requestId}] 🔍 Middleware processing request: ${c.req.method} ${c.req.url}`);

  try {
    // Check request body size before processing
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const bytes = parseInt(contentLength);
      logger.info(`[${requestId}] 📏 Request size: ${bytes} bytes`);
      // Cloudflare Workers has a 100MB limit
      if (bytes > 100 * 1024 * 1024) {
        logger.warn(`[${requestId}] ❌ Request exceeds Cloudflare Workers 100MB limit: ${bytes} bytes`);
        return c.json({
          error: {
            type: 'invalid_request_error',
            message: 'Request payload too large. Cloudflare Workers has a 100MB limit. Please reduce the size of your request or break it into smaller parts.'
          }
        }, 413);
      }
      if (bytes > 50 * 1024 * 1024) {
        logger.warn(`[${requestId}] ⚠️ Large request detected: ${bytes} bytes`);
      }
    }

    await next();
    logger.info(`[${requestId}] ✅ Middleware completed successfully`);
  } catch (error: any) {
    if (error.status === 413 || (error.message && error.message.includes('limit'))) {
      logger.warn(`[${requestId}] ❌ 413 Payload Too Large error caught: ${error.message}`);
      return c.json({
        error: {
          type: 'invalid_request_error',
          message: 'Request payload too large. Please reduce the size of your request or break it into smaller parts.'
        }
      }, 413);
    }
    logger.error(`[${requestId}] ❌ Middleware error: ${error.message}`);
    throw error;
  }
});

// Middleware for API key validation
const validateApiKey = async (c: any, next: any) => {
  const requestId = uuidv4();
  logger.info(`[${requestId}] 🔑 API key validation middleware - No global validation needed`);
  await next();
};

// Messages endpoint
app.post('/v1/messages', validateApiKey, async (c) => {
  const requestId = uuidv4();
  const startTime = Date.now();
  const config = getConfig(c.env);

  logger.info(`[${requestId}] 🚀 New request received to /v1/messages`);

  try {
    const request: ClaudeMessagesRequest = await c.req.json();
    logger.info(`[${requestId}] ✅ Request body parsed successfully`);

    const openaiApiKey = ApiKeyExtractor.extractApiKey({
      'x-api-key': c.req.header('x-api-key'),
      'authorization': c.req.header('authorization')
    });

    if (request.max_tokens && request.max_tokens > config.maxTokensLimit) {
      logger.warn(`[${requestId}] ❌ max_tokens (${request.max_tokens}) exceeds limit (${config.maxTokensLimit})`);
      throw new HTTPException(400, {
        message: `max_tokens (${request.max_tokens}) exceeds limit (${config.maxTokensLimit})`
      });
    }

    // Create OpenAI client for this request
    const openaiClient = new OpenAIClient(
      '',
      config.openaiBaseUrl,
      config.requestTimeout,
      config.azureApiVersion
    );

    const openaiRequest = convertClaudeToOpenAI(request, modelManager);

    // Ensure max_tokens doesn't exceed limit
    if (openaiRequest.max_tokens && openaiRequest.max_tokens > config.maxTokensLimit) {
      openaiRequest.max_tokens = config.maxTokensLimit;
    }

    if (request.stream) {
      logger.info(`[${requestId}] 🌊 Starting streaming response...`);
      
      const openaiStream = await openaiClient.createChatCompletionStream(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );

      const stream = new ReadableStream({
        async start(controller) {
          try {
            const claudeStream = convertOpenAIStreamingToClaudeWithCancellation(
              openaiStream,
              request,
              logger,
              openaiClient,
              requestId
            );

            let chunkCount = 0;
            for await (const chunk of claudeStream) {
              chunkCount++;
              const event = `event: completion\ndata: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(new TextEncoder().encode(event));
            }
            logger.info(`[${requestId}] ✅ Stream completed with ${chunkCount} chunks`);
            controller.enqueue(new TextEncoder().encode('event: done\ndata: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            logger.error(`[${requestId}] ❌ Streaming error: ${errorMessage}`);
            const errorEvent = `event: error\ndata: ${JSON.stringify({ error: { type: 'error', message: errorMessage } })}\n\n`;
            controller.enqueue(new TextEncoder().encode(errorEvent));
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        },
      });
    } else {
      const openaiResponse = await openaiClient.createChatCompletion(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );

      const claudeResponse = convertOpenAIToClaudeResponse(openaiResponse, request);
      const duration = Date.now() - startTime;
      logger.info(`[${requestId}] 🎯 Request completed successfully in ${duration}ms`);

      return c.json(claudeResponse);
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    if (error instanceof HTTPException) {
      logger.warn(`[${requestId}] ⚠️ HTTP Exception (${error.status}): ${error.message} - Duration: ${duration}ms`);
      throw error;
    }

    logger.error(`[${requestId}] ❌ Unexpected error processing request: ${error.message} - Duration: ${duration}ms`);
    const openaiClient = new OpenAIClient('', config.openaiBaseUrl, config.requestTimeout);
    const errorMessage = openaiClient.classifyOpenAIError(error.message);
    throw new HTTPException(500, { message: errorMessage });
  }
});

// Token count endpoint
app.post('/v1/messages/count_tokens', validateApiKey, async (c) => {
  const requestId = uuidv4();
  logger.info(`[${requestId}] 🔢 Token count request received`);

  try {
    const request: ClaudeTokenCountRequest = await c.req.json();
    const result = TokenCounter.countTokens(request);
    logger.info(`[${requestId}] ✅ Token count completed: ${result.input_tokens} input tokens`);
    return c.json(result);
  } catch (error: any) {
    logger.error(`[${requestId}] ❌ Error counting tokens: ${error.message}`);
    throw new HTTPException(500, { message: error.message });
  }
});

// Health check endpoint
app.get('/health', async (c) => {
  const config = getConfig(c.env);
  logger.info(`🏥 Health check request received`);
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    openai_api_configured: true,
    api_key_valid: true,
    client_api_key_validation: false,
    platform: 'cloudflare-workers'
  });
});

// Root endpoint
app.get('/', async (c) => {
  const config = getConfig(c.env);
  logger.info(`🏠 Root endpoint accessed`);
  return c.json({
    message: 'Claude-to-OpenAI API Proxy v1.0.0',
    status: 'running',
    platform: 'cloudflare-workers',
    config: {
      openai_base_url: config.openaiBaseUrl,
      max_tokens_limit: config.maxTokensLimit,
      api_key_configured: false,
      client_api_key_validation: false,
      big_model: config.bigModel,
      middle_model: config.middleModel,
      small_model: config.smallModel
    },
    endpoints: {
      messages: '/v1/messages',
      count_tokens: '/v1/messages/count_tokens',
      health: '/health'
    }
  });
});

// Export the fetch handler for Cloudflare Workers
export default {
  fetch: app.fetch,
};