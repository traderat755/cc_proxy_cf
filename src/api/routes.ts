import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../core/config';
import { logger } from '../core/logger';
import { TokenCounter, ApiKeyExtractor } from '../core/shared-utils';
import { OpenAIClient } from '../core/client';
import { modelManager } from '../core/model-manager';
import { ClaudeMessagesRequest, ClaudeTokenCountRequest } from '../models/claude';
import { convertClaudeToOpenAI } from '../conversion/request-converter';
import {
  convertOpenAIToClaudeResponse,
  convertOpenAIStreamingToClaudeWithCancellation
} from '../conversion/response-converter';

const app = new Hono();

// Configuration and client setup
let appConfig: any;
let openaiClient: OpenAIClient;

// Initialize configuration and client
const initializeApp = (envConfig?: any) => {
  appConfig = envConfig || config;
  openaiClient = new OpenAIClient(
    '', // API key now comes from client requests
    appConfig.openaiBaseUrl,
    appConfig.requestTimeout,
    appConfig.azureApiVersion
  );
};

// Initialize with default config
initializeApp();

// Middleware to handle 413 errors gracefully and validate request size
app.use('/v1/*', async (c, next) => {
  const requestId = uuidv4();
  logger.info(`[${requestId}] 🔍 Middleware processing request: ${c.req.method} ${c.req.url}`);

  try {
    // Check request body size before processing
    // This is a preventive measure to catch large requests early
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const bytes = parseInt(contentLength);
      logger.info(`[${requestId}] 📏 Request size: ${bytes} bytes`);
      // Warn for large requests
      if (bytes > 50 * 1024 * 1024) {
        logger.warn(`[${requestId}] ⚠️ Large request detected: ${bytes} bytes`);
      }
    } else {
      logger.info(`[${requestId}] 📏 No content-length header found`);
    }

    await next();
    logger.info(`[${requestId}] ✅ Middleware completed successfully`);
  } catch (error: any) {
    // Check if this is a payload too large error
    // Note: In Cloudflare Workers, the limit is 100MB, but other platforms may have different limits
    if (error.status === 413 || (error.message && error.message.includes('limit'))) {
      logger.warn(`[${requestId}] ❌ 413 Payload Too Large error caught: ${error.message}`);
      // Return a more helpful error message
      return c.json({
        error: {
          type: 'invalid_request_error',
          message: 'Request payload too large. Please reduce the size of your request or break it into smaller parts. For large context requests, consider using smaller prompts or fewer messages.'
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
  // No global API key validation needed - each request will provide its own OpenAI API key
  await next();
};

// Messages endpoint
app.post('/v1/messages', validateApiKey, async (c) => {
  const requestId = uuidv4();
  const startTime = Date.now();

  logger.info(`[${requestId}] 🚀 New request received to /v1/messages`);
  logger.info(`[${requestId}] 📍 Request URL: ${c.req.url}`);
  logger.info(`[${requestId}] 🔑 Headers: ${JSON.stringify(c.req.header())}`);

  try {
    logger.info(`[${requestId}] 📝 Parsing request body...`);
    const request: ClaudeMessagesRequest = await c.req.json();
    logger.info(`[${requestId}] ✅ Request body parsed successfully`);
    logger.info(`[${requestId}] 📊 Request details: model=${request.model}, stream=${request.stream}, max_tokens=${request.max_tokens}`);

    logger.info(`[${requestId}] 🔑 Extracting API key from headers...`);
    const openaiApiKey = ApiKeyExtractor.extractApiKey({
      'x-api-key': c.req.header('x-api-key'),
      'authorization': c.req.header('authorization')
    });
    logger.info(`[${requestId}] ${openaiApiKey ? '✅ API key extracted' : '⚠️ No API key found'}`);

    // Validate token limits using current config
    const currentConfig = (globalThis as any).CONFIG || appConfig;
    logger.info(`[${requestId}] ⚙️ Using config: maxTokensLimit=${currentConfig.maxTokensLimit}`);

    if (request.max_tokens && request.max_tokens > currentConfig.maxTokensLimit) {
      logger.warn(`[${requestId}] ❌ max_tokens (${request.max_tokens}) exceeds limit (${currentConfig.maxTokensLimit})`);
      throw new HTTPException(400, {
        message: `max_tokens (${request.max_tokens}) exceeds limit (${currentConfig.maxTokensLimit})`
      });
    }

    logger.info(`[${requestId}] 🔄 Converting Claude request to OpenAI format...`);
    // Convert Claude request to OpenAI format
    const openaiRequest = convertClaudeToOpenAI(request, modelManager);
    logger.info(`[${requestId}] ✅ Request converted to OpenAI format`);

    // Log payload size to help diagnose 413
    try {
      const payloadSize = JSON.stringify(openaiRequest).length;
      logger.info(`[${requestId}] 📦 OpenAI payload size: ${payloadSize} bytes`);
      if (payloadSize > 700 * 1024) {
        logger.warn(`[${requestId}] ⚠️ OpenAI payload is large (>700KB): ${payloadSize} bytes`);
      }
    } catch (e) {
      logger.warn(`[${requestId}] ⚠️ Could not determine payload size: ${e}`);
    }

    // Ensure max_tokens doesn't exceed limit
    if (openaiRequest.max_tokens && openaiRequest.max_tokens > currentConfig.maxTokensLimit) {
      logger.warn(`[${requestId}] ⚠️ Reducing max_tokens from ${openaiRequest.max_tokens} to ${currentConfig.maxTokensLimit}`);
      openaiRequest.max_tokens = currentConfig.maxTokensLimit;
    }

    if (request.stream) {
      logger.info(`[${requestId}] 🌊 Starting streaming response...`);
      // Set streaming headers
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Headers', '*');

      // Use ReadableStream for streaming
      logger.info(`[${requestId}] 📡 Creating OpenAI streaming completion...`);
      const openaiStream = await openaiClient.createChatCompletionStream(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );
      logger.info(`[${requestId}] ✅ OpenAI streaming started`);

      // Store the AbortController for the OpenAI stream
      const abortController = new AbortController();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            logger.info(`[${requestId}] 🔄 Converting OpenAI stream to Claude format...`);
            const claudeStream = convertOpenAIStreamingToClaudeWithCancellation(
              openaiStream,
              request,
              logger,
              openaiClient,
              requestId
            );
            logger.info(`[${requestId}] ✅ Stream conversion ready`);

            // Handle abort signal
            if (abortController.signal) {
              abortController.signal.addEventListener('abort', () => {
                logger.info(`[${requestId}] 🚫 Stream was aborted`);
                // Clean up resources if needed when aborted
                controller.error(new Error('Stream was aborted'));
              });
            }

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
        },
        cancel() {
          logger.info(`[${requestId}] 🚫 Stream was cancelled`);
          // Abort the stream when cancelled
          abortController.abort();
        },
      });

      logger.info(`[${requestId}] 🎯 Returning streaming response`);
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
      logger.info(`[${requestId}] 📤 Starting non-streaming response...`);
      // Non-streaming response
      logger.info(`[${requestId}] 📡 Creating OpenAI completion...`);
      const openaiResponse = await openaiClient.createChatCompletion(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );
      logger.info(`[${requestId}] ✅ OpenAI response received`);

      logger.info(`[${requestId}] 🔄 Converting OpenAI response to Claude format...`);
      const claudeResponse = convertOpenAIToClaudeResponse(openaiResponse, request);
      logger.info(`[${requestId}] ✅ Response converted to Claude format`);

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
    logger.info(`[${requestId}] 📝 Request parsed: ${JSON.stringify(request)}`);

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
  logger.info(`🏥 Health check request received from ${c.req.header('user-agent') || 'unknown'}`);
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    openai_api_configured: true,
    api_key_valid: true,
    client_api_key_validation: false
  });
});

// Root endpoint
app.get('/', async (c) => {
  logger.info(`🏠 Root endpoint accessed from ${c.req.header('user-agent') || 'unknown'}`);
  return c.json({
    message: 'Claude-to-OpenAI API Proxy v1.0.0',
    status: 'running',
    config: {
      openai_base_url: appConfig.openaiBaseUrl,
      max_tokens_limit: appConfig.maxTokensLimit,
      api_key_configured: false,
      client_api_key_validation: false,
      big_model: appConfig.bigModel,
      middle_model: appConfig.middleModel,
      small_model: appConfig.smallModel
    },
    endpoints: {
      messages: '/v1/messages',
      count_tokens: '/v1/messages/count_tokens',
      health: '/health',
      test_connection: '/test-connection'
    }
  });
});

export default app;