import { v4 as uuidv4 } from 'uuid';
import { logger } from './core/logger';
import { ApiKeyExtractor } from './core/shared-utils';
import { OpenAIClient } from './core/client';
import { modelManager } from './core/model-manager';
import { ClaudeMessagesRequest } from './models/claude';
import { convertClaudeToOpenAI } from './conversion/request-converter';
import {
  convertOpenAIToClaudeResponse,
  convertOpenAIStreamingToClaudeWithCancellation
} from './conversion/response-converter';
import type { ExecutionContext } from '@cloudflare/workers-types';

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
  MAX_REQUEST_SIZE?: string;
}

// Configuration helper
const getConfig = (env: Env) => ({
  openaiBaseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  bigModel: env.BIG_MODEL || 'openai/gpt-oss-120b',
  middleModel: env.MIDDLE_MODEL || 'openai/gpt-oss-120b',
  smallModel: env.SMALL_MODEL || 'gpt-oss-20b',
  maxTokensLimit: parseInt(env.MAX_TOKENS_LIMIT || '40960'),
  minTokensLimit: parseInt(env.MIN_TOKENS_LIMIT || '100'),
  requestTimeout: parseInt(env.REQUEST_TIMEOUT || '90'),
  azureApiVersion: env.AZURE_API_VERSION || '2024-02-01',
  logLevel: env.LOG_LEVEL || 'WARNING',
  maxRequestSize: parseInt(env.MAX_REQUEST_SIZE || '800000')
});

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

// Helper to create JSON responses
const jsonResponse = (data: any, status = 200, headers: Record<string, string> = {}) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers
    },
  });
};

// Handle OPTIONS requests for CORS preflight
const handleOptions = (request: Request) => {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return new Response(null, { status: 204 });
};

// Handle request body parsing with size limits
const parseRequestBody = async (request: Request, requestId: string): Promise<any> => {
  const contentLength = request.headers.get('content-length');
  
  if (contentLength) {
    const bytes = parseInt(contentLength);
    logger.info(`[${requestId}] 📏 Request size: ${bytes} bytes`);
    
    // Cloudflare Workers has a 100MB limit
    if (bytes > 100 * 1024 * 1024) {
      logger.warn(`[${requestId}] ❌ Request exceeds Cloudflare Workers 100MB limit: ${bytes} bytes`);
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    
    if (bytes > 50 * 1024 * 1024) {
      logger.warn(`[${requestId}] ⚠️ Large request detected: ${bytes} bytes`);
    }
  }

  try {
    return await request.json();
  } catch (error) {
    logger.error(`[${requestId}] ❌ Error parsing request body: ${error}`);
    throw new Error('INVALID_JSON');
  }
};

// Handle messages endpoint
const handleMessages = async (request: Request, env: Env) => {
  const requestId = uuidv4();
  const startTime = Date.now();
  const config = getConfig(env);

  logger.info(`[${requestId}] 🚀 New request received to /v1/messages`);

  try {
    const requestBody = await parseRequestBody(request, requestId) as ClaudeMessagesRequest;
    logger.info(`[${requestId}] ✅ Request body parsed successfully`);

    const openaiApiKey = ApiKeyExtractor.extractApiKey({
      'x-api-key': request.headers.get('x-api-key') || '',
      'authorization': request.headers.get('authorization') || ''
    });

    if (requestBody.max_tokens && requestBody.max_tokens > config.maxTokensLimit) {
      logger.warn(`[${requestId}] ❌ max_tokens (${requestBody.max_tokens}) exceeds limit (${config.maxTokensLimit})`);
      return jsonResponse({
        error: {
          type: 'invalid_request_error',
          message: `max_tokens (${requestBody.max_tokens}) exceeds limit (${config.maxTokensLimit})`
        }
      }, 400);
    }

    // Create OpenAI client for this request
    const openaiClient = new OpenAIClient(
      '',
      config.openaiBaseUrl,
      config.requestTimeout,
      config.azureApiVersion
    );

    const openaiRequest = convertClaudeToOpenAI(requestBody, modelManager, { maxTotalRequestSize: config.maxRequestSize });

    // Ensure max_tokens doesn't exceed limit
    if (openaiRequest.max_tokens && openaiRequest.max_tokens > config.maxTokensLimit) {
      openaiRequest.max_tokens = config.maxTokensLimit;
    }

    if (requestBody.stream) {
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
              requestBody,
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
          ...corsHeaders,
        },
      });
    } else {
      const openaiResponse = await openaiClient.createChatCompletion(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );

      const claudeResponse = convertOpenAIToClaudeResponse(openaiResponse, requestBody);
      const duration = Date.now() - startTime;
      logger.info(`[${requestId}] 🎯 Request completed successfully in ${duration}ms`);

      return jsonResponse(claudeResponse);
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    if (error.message === 'PAYLOAD_TOO_LARGE') {
      return jsonResponse({
        error: {
          type: 'invalid_request_error',
          message: 'Request payload too large. Cloudflare Workers has a 100MB limit. Please reduce the size of your request or break it into smaller parts.'
        }
      }, 413);
    }
    
    if (error.message === 'INVALID_JSON') {
      return jsonResponse({
        error: {
          type: 'invalid_request_error',
          message: 'Invalid JSON in request body'
        }
      }, 400);
    }

    logger.error(`[${requestId}] ❌ Unexpected error processing request: ${error.message} - Duration: ${duration}ms`);
    const openaiClient = new OpenAIClient('', config.openaiBaseUrl, config.requestTimeout);
    const errorMessage = openaiClient.classifyOpenAIError(error.message);
    
    return jsonResponse({
      error: {
        type: 'api_error',
        message: errorMessage
      }
    }, 500);
  }
};



// Handle root endpoint
const handleRoot = (env: Env) => {
  const config = getConfig(env);
  logger.info(`🏠 Root endpoint accessed`);
  return jsonResponse({
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
      messages: '/v1/messages'
    }
  });
};

// Main request handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Route requests
    try {
      if (path === '/v1/messages' && method === 'POST') {
        return handleMessages(request, env);
      } else if ((path === '/' || path === '') && method === 'GET') {
        return handleRoot(env);
      } else {
        return jsonResponse({
          error: {
            type: 'not_found',
            message: 'The requested resource was not found.'
          }
        }, 404);
      }
    } catch (error: any) {
      return jsonResponse({
        error: {
          type: 'internal_server_error',
          message: error.message
        }
      }, 500);
    }
  }
};