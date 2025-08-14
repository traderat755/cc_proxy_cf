import { ClaudeMessagesRequest, ClaudeMessage } from '../models/claude.js';
import { ModelManager } from '../core/model-manager.js';

export function convertClaudeToOpenAI(request: ClaudeMessagesRequest, modelManager: ModelManager): any {
  const openaiRequest: any = {
    model: modelManager.getOpenAIModel(request.model),
    messages: [],
    max_tokens: request.max_tokens,
    stream: request.stream || false
  };

  // Add optional parameters
  if (request.temperature !== undefined) {
    openaiRequest.temperature = request.temperature;
  }
  
  if (request.top_p !== undefined) {
    openaiRequest.top_p = request.top_p;
  }
  
  if (request.stop_sequences && request.stop_sequences.length > 0) {
    openaiRequest.stop = request.stop_sequences;
  }

  // Convert system message
  if (request.system) {
    if (typeof request.system === 'string') {
      openaiRequest.messages.push({
        role: 'system',
        content: request.system
      });
    } else if (Array.isArray(request.system)) {
      const systemContent = request.system
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      
      if (systemContent) {
        openaiRequest.messages.push({
          role: 'system',
          content: systemContent
        });
      }
    }
  }

  // Convert messages
  for (const message of request.messages) {
    const openaiMessage = convertClaudeMessage(message);
    if (openaiMessage) {
      openaiRequest.messages.push(openaiMessage);
    }
  }

  return openaiRequest;
}

function convertClaudeMessage(message: ClaudeMessage): any {
  if (typeof message.content === 'string') {
    return {
      role: message.role,
      content: message.content
    };
  }

  if (Array.isArray(message.content)) {
    const content: any[] = [];
    
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        content.push({
          type: 'text',
          text: block.text
        });
      } else if (block.type === 'image' && block.source) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        });
      }
    }

    if (content.length > 0) {
      return {
        role: message.role,
        content: content
      };
    }
  }

  return null;
}