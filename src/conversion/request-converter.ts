import { ClaudeMessagesRequest, ClaudeMessage } from '../models/claude.js';
import { ModelManager } from '../core/model-manager.js';
import { truncateContent, safeJsonStringify } from './shared-converters.js';

const MAX_TOTAL_REQUEST_SIZE = 300000;

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

  // Convert tools
  if (request.tools && request.tools.length > 0) {
    openaiRequest.tools = request.tools.map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }

  // Convert system message
  if (request.system) {
    if (typeof request.system === 'string') {
      openaiRequest.messages.push({
        role: 'system',
        content: truncateContent(request.system)
      });
    } else if (Array.isArray(request.system)) {
      const systemContent = request.system
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      
      if (systemContent) {
        openaiRequest.messages.push({
          role: 'system',
          content: truncateContent(systemContent)
        });
      }
    }
  }

  // Convert messages using simplified approach
  const convertedMessages = convertMessages(request.messages);
  
  // Check request size incrementally
  let currentSize = JSON.stringify({
    ...openaiRequest,
    messages: []
  }).length;
  
  const finalMessages = [];
  for (const message of convertedMessages) {
    const messageSize = JSON.stringify(message).length;
    if (currentSize + messageSize > MAX_TOTAL_REQUEST_SIZE) {
      console.warn(`Stopping message addition at ${finalMessages.length} messages to prevent 413 error`);
      break;
    }
    finalMessages.push(message);
    currentSize += messageSize;
  }
  
  openaiRequest.messages = finalMessages;

  return openaiRequest;
}


function truncateMessages(messages: any[], maxSize: number): any[] {
  let currentSize = JSON.stringify(messages).length;
  const truncatedMessages = [...messages];
  
  // Remove messages from the beginning (keeping system and latest messages)
  while (currentSize > maxSize && truncatedMessages.length > 2) {
    // Keep system message and remove from index 1
    if (truncatedMessages[0]?.role === 'system') {
      truncatedMessages.splice(1, 1);
    } else {
      truncatedMessages.splice(0, 1);
    }
    currentSize = JSON.stringify(truncatedMessages).length;
  }
  
  return truncatedMessages;
}

function convertMessages(claudeMessages: ClaudeMessage[]): any[] {
  const openaiMessages: any[] = [];
  
  for (const message of claudeMessages) {
    if (typeof message.content === 'string') {
      openaiMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: truncateContent(message.content)
      });
      continue;
    }

    const textContents: string[] = [];
    const toolCalls: any[] = [];
    const toolResults: Array<{ tool_call_id: string; content: string }> = [];

    for (const content of message.content) {
      switch (content.type) {
        case 'text':
          textContents.push(content.text || '');
          break;
        case 'tool_use':
          toolCalls.push({
            id: content.id,
            type: 'function',
            function: {
              name: content.name,
              arguments: safeJsonStringify(content.input || {})
            }
          });
          break;
        case 'tool_result':
          const resultContent = typeof content.content === 'string' 
            ? content.content 
            : safeJsonStringify(content.content);
          toolResults.push({
            tool_call_id: content.tool_use_id || '',
            content: truncateContent(resultContent)
          });
          break;
      }
    }

    // Add message with text and/or tool calls
    if (textContents.length > 0 || toolCalls.length > 0) {
      const openaiMessage: any = {
        role: message.role === 'assistant' ? 'assistant' : 'user'
      };

      if (textContents.length > 0) {
        openaiMessage.content = truncateContent(textContents.join('\n'));
      } else if (toolCalls.length === 0) {
        openaiMessage.content = '';
      }

      if (toolCalls.length > 0) {
        openaiMessage.tool_calls = toolCalls;
      }

      openaiMessages.push(openaiMessage);
    }

    // Add tool result messages
    for (const toolResult of toolResults) {
      openaiMessages.push({
        role: 'tool',
        tool_call_id: toolResult.tool_call_id,
        content: toolResult.content
      });
    }
  }

  return openaiMessages;
}