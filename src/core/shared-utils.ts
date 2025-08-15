import { ClaudeTokenCountRequest } from '../models/claude';

export class OpenAIErrorClassifier {
  static classifyError(errorMessage: string): string {
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

export class TokenCounter {
  static countTokens(request: ClaudeTokenCountRequest): { input_tokens: number } {
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
    
    return { input_tokens: estimatedTokens };
  }
}

export class ApiKeyExtractor {
  static extractApiKey(headers: { 'x-api-key'?: string; authorization?: string }): string | null {
    if (headers['x-api-key']) {
      return headers['x-api-key'];
    }
    
    if (headers.authorization && headers.authorization.startsWith('Bearer ')) {
      return headers.authorization.replace('Bearer ', '');
    }
    
    return null;
  }
}