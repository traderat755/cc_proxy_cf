import { logger } from './logger.js';

export class CloudflareOpenAIClient {
  private baseURL: string;
  private timeout: number;
  private apiVersion?: string;

  constructor(baseURL: string, timeout: number, apiVersion?: string) {
    this.baseURL = baseURL;
    this.timeout = timeout * 1000; // Convert to milliseconds
    this.apiVersion = apiVersion;
  }

  async createChatCompletion(request: any, requestId?: string, apiKey?: string): Promise<any> {
    try {
      const url = new URL(`${this.baseURL}/chat/completions`);
      
      // Add Azure API version if specified
      if (this.apiVersion) {
        url.searchParams.append('api-version', this.apiVersion);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Add Azure API key header if using Azure
      if (this.apiVersion && apiKey) {
        headers['api-key'] = apiKey;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      logger.error(`OpenAI API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  async createChatCompletionStream(request: any, requestId?: string, apiKey?: string): Promise<ReadableStream> {
    try {
      const url = new URL(`${this.baseURL}/chat/completions`);
      
      // Add Azure API version if specified
      if (this.apiVersion) {
        url.searchParams.append('api-version', this.apiVersion);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Add Azure API key header if using Azure
      if (this.apiVersion && apiKey) {
        headers['api-key'] = apiKey;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: true }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      return response.body;
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