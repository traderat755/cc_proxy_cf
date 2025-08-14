import OpenAI from 'openai';
import { logger } from './logger.js';

export class OpenAIClient {
  private client: OpenAI;
  private baseURL: string;
  private timeout: number;
  private apiVersion?: string;

  constructor(apiKey: string, baseURL: string, timeout: number, apiVersion?: string) {
    this.baseURL = baseURL;
    this.timeout = timeout * 1000; // Convert to milliseconds
    this.apiVersion = apiVersion;
    
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: this.baseURL,
      timeout: this.timeout,
      defaultHeaders: apiVersion ? {
        'api-version': apiVersion
      } : undefined
    });
  }

  async createChatCompletion(request: any, requestId?: string, apiKey?: string): Promise<any> {
    try {
      // Create a new client instance if a different API key is provided
      const clientToUse = apiKey ? new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        timeout: this.timeout,
        defaultHeaders: this.apiVersion ? {
          'api-version': this.apiVersion
        } : undefined
      }) : this.client;

      const response = await clientToUse.chat.completions.create(request);
      return response;
    } catch (error: any) {
      logger.error(`OpenAI API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  createChatCompletionStream(request: any, requestId?: string, apiKey?: string): AsyncIterable<any> {
    try {
      // Create a new client instance if a different API key is provided
      const clientToUse = apiKey ? new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        timeout: this.timeout,
        defaultHeaders: this.apiVersion ? {
          'api-version': this.apiVersion
        } : undefined
      }) : this.client;

      return clientToUse.chat.completions.create({
        ...request,
        stream: true
      }) as unknown as AsyncIterable<any>;
    } catch (error: any) {
      logger.error(`OpenAI streaming API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  classifyOpenAIError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();
    
    if (message.includes('invalid api key') || message.includes('unauthorized')) {
      return 'Invalid API key provided. Please check your OpenAI API key.';
    }
    
    if (message.includes('quota exceeded') || message.includes('rate limit')) {
      return 'Rate limit or quota exceeded. Please try again later.';
    }
    
    if (message.includes('model not found') || message.includes('model does not exist')) {
      return 'The requested model is not available or does not exist.';
    }
    
    if (message.includes('context_length_exceeded') || message.includes('maximum context length')) {
      return 'Request too long. Please reduce the message length or max_tokens.';
    }
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'Request timed out. Please try again.';
    }
    
    return errorMessage;
  }
}