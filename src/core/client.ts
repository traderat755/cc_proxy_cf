import OpenAI from 'openai';
import { logger } from './logger.js';
import { OpenAIErrorClassifier } from './shared-utils.js';

export class OpenAIClient {
  private client?: OpenAI;
  private baseURL: string;
  private timeout: number;
  private apiVersion?: string;
  private useCloudflare: boolean;

  constructor(apiKey: string | undefined, baseURL: string, timeout: number, apiVersion?: string, useCloudflare: boolean = false) {
    this.baseURL = baseURL;
    this.timeout = timeout * 1000; // Convert to milliseconds
    this.apiVersion = apiVersion;
    this.useCloudflare = useCloudflare;
    
    // Only create OpenAI client if not using Cloudflare
    if (!useCloudflare && apiKey) {
      this.client = new OpenAI({
        apiKey: apiKey,
        baseURL: this.baseURL,
        timeout: this.timeout,
        defaultHeaders: apiVersion ? {
          'api-version': apiVersion
        } : undefined
      });
    }
  }

  async createChatCompletion(request: any, requestId?: string, apiKey?: string): Promise<any> {
    if (this.useCloudflare) {
      return this.createChatCompletionCloudflare(request, requestId, apiKey);
    }

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

      if (!clientToUse) {
        throw new Error('OpenAI client not initialized');
      }

      const response = await clientToUse.chat.completions.create(request);
      return response;
    } catch (error: any) {
      logger.error(`OpenAI API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  createChatCompletionStream(request: any, requestId?: string, apiKey?: string): AsyncIterable<any> | Promise<ReadableStream> {
    if (this.useCloudflare) {
      return this.createChatCompletionStreamCloudflare(request, requestId, apiKey);
    }

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

      if (!clientToUse) {
        throw new Error('OpenAI client not initialized');
      }

      return clientToUse.chat.completions.create({
        ...request,
        stream: true
      }) as unknown as AsyncIterable<any>;
    } catch (error: any) {
      logger.error(`OpenAI streaming API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  private async createChatCompletionCloudflare(request: any, requestId?: string, apiKey?: string): Promise<any> {
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

  private async createChatCompletionStreamCloudflare(request: any, requestId?: string, apiKey?: string): Promise<ReadableStream> {
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
    return OpenAIErrorClassifier.classifyError(errorMessage);
  }
}