import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { stream, streamSSE } from 'hono/streaming';
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

// Support for Cloudflare response converter if available
let cfResponseConverter: any = null;
(async () => {
  try {
    cfResponseConverter = await import('../conversion/response-converter');
  } catch {
    // Fallback to regular response converter
  }
})();

const app = new Hono();

// Configuration and client setup
let appConfig: any;
let openaiClient: OpenAIClient;

// Initialize configuration and client
const initializeApp = (isCloudflare: boolean = false, envConfig?: any) => {
  appConfig = envConfig || config;
  openaiClient = new OpenAIClient(
    '', // API key now comes from client requests
    appConfig.openaiBaseUrl,
    appConfig.requestTimeout,
    appConfig.azureApiVersion,
    isCloudflare
  );
};

// Initialize with default config for non-Cloudflare environments
initializeApp();

// Middleware to handle Cloudflare Workers environment
app.use('*', async (c, next) => {
  // @ts-ignore - Check if running in Cloudflare Workers and get config
  const cfConfig = globalThis.CONFIG;
  if (cfConfig) {
    // Reinitialize for Cloudflare if needed
    if (!openaiClient || appConfig !== cfConfig) {
      initializeApp(true, cfConfig);
    }
  }
  await next();
});

// Middleware for API key validation
const validateApiKey = async (c: any, next: any) => {
  // No global API key validation needed - each request will provide its own OpenAI API key
  await next();
};

// Messages endpoint
app.post('/v1/messages', validateApiKey, async (c) => {
  try {
    const request: ClaudeMessagesRequest = await c.req.json();
    
    logger.debug(`Processing Claude request: model=${request.model}, stream=${request.stream}`);
    
    const requestId = uuidv4();
    
    // Extract OpenAI API key from request headers
    const openaiApiKey = ApiKeyExtractor.extractApiKey({
      'x-api-key': c.req.header('x-api-key'),
      authorization: c.req.header('authorization')
    });
    
    // Validate token limits using current config
    const currentConfig = (globalThis as any).CONFIG || appConfig;
    if (request.max_tokens && request.max_tokens > currentConfig.maxTokensLimit) {
      throw new HTTPException(400, {
        message: `max_tokens (${request.max_tokens}) exceeds limit (${currentConfig.maxTokensLimit})`
      });
    }
    
    // Convert Claude request to OpenAI format
    const openaiRequest = convertClaudeToOpenAI(request, modelManager);
    
    // Ensure max_tokens doesn't exceed limit
    if (openaiRequest.max_tokens && openaiRequest.max_tokens > currentConfig.maxTokensLimit) {
      openaiRequest.max_tokens = currentConfig.maxTokensLimit;
    }
    
    // @ts-ignore - Check if running in Cloudflare Workers
    const isCloudflare = !!(c.env?.CONFIG || globalThis.CONFIG);
    
    if (request.stream) {
      // Set streaming headers
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Headers', '*');
      
      // Choose streaming method based on environment
      if (isCloudflare) {
        // Cloudflare Workers - use streamSSE
        return streamSSE(c, async (stream) => {
          try {
            const openaiStream = await openaiClient.createChatCompletionStream(
              openaiRequest,
              requestId,
              openaiApiKey || undefined
            );
            
            const responseConverter = cfResponseConverter || { convertOpenAIStreamingToClaudeWithCancellation };
            const claudeStream = responseConverter.convertOpenAIStreamingToClaudeWithCancellation(
              openaiStream,
              request,
              logger,
              null, // HTTP request for disconnection check (not available in Hono)
              openaiClient,
              requestId
            );
            
            for await (const chunk of claudeStream) {
              await stream.writeSSE({ data: chunk, event: 'message', id: requestId });
            }
            await stream.close();
          } catch (error: any) {
            logger.error(`Streaming error: ${error.message}`);
            const errorMessage = openaiClient.classifyOpenAIError(error.message);
            const errorResponse = {
              type: 'error',
              error: { type: 'api_error', message: errorMessage }
            };
            await stream.writeSSE({ data: JSON.stringify(errorResponse), event: 'error', id: requestId });
            await stream.close();
          }
        });
      } else {
        // Regular Node.js - use stream
        return stream(c, async (stream) => {
          try {
            const openaiStream = await openaiClient.createChatCompletionStream(
              openaiRequest,
              requestId,
              openaiApiKey || undefined
            );
            
            const claudeStream = convertOpenAIStreamingToClaudeWithCancellation(
              openaiStream,
              request,
              logger,
              null, // HTTP request for disconnection check (not available in Hono)
              requestId
            );
            
            for await (const chunk of claudeStream) {
              await stream.write(chunk);
            }
          } catch (error: any) {
            logger.error(`Streaming error: ${error.message}`);
            const errorMessage = openaiClient.classifyOpenAIError(error.message);
            const errorResponse = {
              type: 'error',
              error: { type: 'api_error', message: errorMessage }
            };
            await stream.write(`event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`);
          }
        });
      }
    } else {
      // Non-streaming response
      const openaiResponse = await openaiClient.createChatCompletion(
        openaiRequest,
        requestId,
        openaiApiKey || undefined
      );
      
      const claudeResponse = convertOpenAIToClaudeResponse(openaiResponse, request);
      return c.json(claudeResponse);
    }
  } catch (error: any) {
    if (error instanceof HTTPException) {
      throw error;
    }
    
    logger.error(`Unexpected error processing request: ${error.message}`);
    const errorMessage = openaiClient.classifyOpenAIError(error.message);
    throw new HTTPException(500, { message: errorMessage });
  }
});

// Token count endpoint
app.post('/v1/messages/count_tokens', validateApiKey, async (c) => {
  try {
    const request: ClaudeTokenCountRequest = await c.req.json();
    const result = TokenCounter.countTokens(request);
    return c.json(result);
  } catch (error: any) {
    logger.error(`Error counting tokens: ${error.message}`);
    throw new HTTPException(500, { message: error.message });
  }
});

// Health check endpoint
app.get('/health', async (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    openai_api_configured: true,
    api_key_valid: true,
    client_api_key_validation: false
  });
});

// Test connection endpoint
app.get('/test-connection', async (c) => {
  try {
    // Extract OpenAI API key from request headers
    const openaiApiKey = ApiKeyExtractor.extractApiKey({
      'x-api-key': c.req.header('x-api-key'),
      authorization: c.req.header('authorization')
    });
    
    // Require API key for test connection
    if (!openaiApiKey) {
      throw new HTTPException(401, { 
        message: 'API key required for test connection. Please provide a valid OpenAI API key in the x-api-key header or Authorization: Bearer header.' 
      });
    }
    
    // @ts-ignore - Check if running in Cloudflare Workers
    const isCloudflare = !!(c.env?.CONFIG || globalThis.CONFIG);
    
    // Create a client with the provided API key
    const client = new OpenAIClient(
      isCloudflare ? undefined : openaiApiKey,
      appConfig.openaiBaseUrl,
      appConfig.requestTimeout,
      appConfig.azureApiVersion,
      isCloudflare
    );
    
    // Simple test request to verify API connectivity
    const testResponse = await client.createChatCompletion(
      {
        model: appConfig.smallModel,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      },
      undefined,
      openaiApiKey
    );
    
    return c.json({
      status: 'success',
      message: 'Successfully connected to OpenAI API',
      model_used: appConfig.smallModel,
      timestamp: new Date().toISOString(),
      response_id: testResponse.id || 'unknown'
    });
  } catch (error: any) {
    logger.error(`API connectivity test failed: ${error.message}`);
    return c.json({
      status: 'failed',
      error_type: 'API Error',
      message: error.message,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Check your OPENAI_API_KEY is valid',
        'Verify your API key has the necessary permissions',
        'Check if you have reached rate limits'
      ]
    }, 503);
  }
});

// Root endpoint
app.get('/', async (c) => {
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