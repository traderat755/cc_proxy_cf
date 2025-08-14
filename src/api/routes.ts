import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { stream } from 'hono/streaming';
import { v4 as uuidv4 } from 'uuid';

import { config } from '../core/config.js';
import { logger } from '../core/logger.js';
import { OpenAIClient } from '../core/client.js';
import { modelManager } from '../core/model-manager.js';
import { ClaudeMessagesRequest, ClaudeTokenCountRequest } from '../models/claude.js';
import { convertClaudeToOpenAI } from '../conversion/request-converter.js';
import { 
  convertOpenAIToClaudeResponse, 
  convertOpenAIStreamingToClaudeWithCancellation 
} from '../conversion/response-converter.js';

const app = new Hono();

const openaiClient = new OpenAIClient(
  '', // API key now comes from client requests
  config.openaiBaseUrl,
  config.requestTimeout,
  config.azureApiVersion
);

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
    let openaiApiKey: string | null = null;
    const xApiKey = c.req.header('x-api-key');
    const authorization = c.req.header('authorization');
    
    if (xApiKey) {
      openaiApiKey = xApiKey;
    } else if (authorization && authorization.startsWith('Bearer ')) {
      openaiApiKey = authorization.replace('Bearer ', '');
    }
    
    // Convert Claude request to OpenAI format
    const openaiRequest = convertClaudeToOpenAI(request, modelManager);
    
    if (request.stream) {
      // Set streaming headers
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      c.header('Access-Control-Allow-Origin', '*');
      c.header('Access-Control-Allow-Headers', '*');
      
      // Streaming response
      return stream(c, async (stream) => {
        try {
          const openaiStream = openaiClient.createChatCompletionStream(
            openaiRequest,
            requestId,
            openaiApiKey || undefined
          );
          
          const claudeStream = convertOpenAIStreamingToClaudeWithCancellation(
            openaiStream,
            request,
            logger,
            null, // HTTP request for disconnection check (not available in Hono)
            openaiClient,
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
    
    let totalChars = 0;
    
    // Count system message characters
    if (request.system) {
      if (typeof request.system === 'string') {
        totalChars += request.system.length;
      } else if (Array.isArray(request.system)) {
        for (const block of request.system) {
          if (block.text) {
            totalChars += block.text.length;
          }
        }
      }
    }
    
    // Count message characters
    for (const msg of request.messages) {
      if (msg.content === null) {
        continue;
      } else if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text) {
            totalChars += block.text.length;
          }
        }
      }
    }
    
    // Rough estimation: 4 characters per token
    const estimatedTokens = Math.max(1, Math.floor(totalChars / 4));
    
    return c.json({ input_tokens: estimatedTokens });
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
    let openaiApiKey: string | null = null;
    const xApiKey = c.req.header('x-api-key');
    const authorization = c.req.header('authorization');
    
    if (xApiKey) {
      openaiApiKey = xApiKey;
    } else if (authorization && authorization.startsWith('Bearer ')) {
      openaiApiKey = authorization.replace('Bearer ', '');
    }
    
    // Require API key for test connection
    if (!openaiApiKey) {
      throw new HTTPException(401, { 
        message: 'API key required for test connection. Please provide a valid OpenAI API key in the x-api-key header or Authorization: Bearer header.' 
      });
    }
    
    // Create a client with the provided API key
    const client = new OpenAIClient(
      openaiApiKey,
      config.openaiBaseUrl,
      config.requestTimeout,
      config.azureApiVersion
    );
    
    // Simple test request to verify API connectivity
    const testResponse = await client.createChatCompletion(
      {
        model: config.smallModel,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      }
    );
    
    return c.json({
      status: 'success',
      message: 'Successfully connected to OpenAI API',
      model_used: config.smallModel,
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
      health: '/health',
      test_connection: '/test-connection'
    }
  });
});

export default app;