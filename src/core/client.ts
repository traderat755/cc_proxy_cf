import { logger } from './logger';
import { OpenAIErrorClassifier } from './shared-utils';

export class OpenAIClient {
  private baseURL: string;
  private timeout: number;
  private apiKey?: string;
  private apiVersion?: string;

  constructor(apiKey: string | undefined, baseURL: string, timeout: number, apiVersion?: string) {
    this.baseURL = baseURL;
    this.timeout = timeout * 1000; // Convert to milliseconds
    this.apiKey = apiKey;
    this.apiVersion = apiVersion;
  }

  async createChatCompletion(request: any, requestId?: string, apiKey?: string): Promise<any> {
    try {
      const url = new URL(`${this.baseURL}/chat/completions`);
      if (this.apiVersion) {
        url.searchParams.append('api-version', this.apiVersion);
      }

      const finalApiKey = apiKey || this.apiKey;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (finalApiKey) {
        headers['Authorization'] = `Bearer ${finalApiKey}`;
        // If using Azure-style endpoint, also support api-key header
        if (this.apiVersion) {
          headers['api-key'] = finalApiKey;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request, stream: false }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

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

  createChatCompletionStream(request: any, requestId?: string, apiKey?: string): Promise<ReadableStream> {
    try {
      const url = new URL(`${this.baseURL}/chat/completions`);
      if (this.apiVersion) {
        url.searchParams.append('api-version', this.apiVersion);
      }

      const finalApiKey = apiKey || this.apiKey;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (finalApiKey) {
        headers['Authorization'] = `Bearer ${finalApiKey}`;
        if (this.apiVersion) {
          headers['api-key'] = finalApiKey;
        }
      }

      return (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...request, stream: true }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        return response.body;
      })();
    } catch (error: any) {
      logger.error(`OpenAI streaming API error (${requestId}): ${error.message}`);
      throw error;
    }
  }

  classifyOpenAIError(errorMessage: string): string {
    return OpenAIErrorClassifier.classifyError(errorMessage);
  }
}