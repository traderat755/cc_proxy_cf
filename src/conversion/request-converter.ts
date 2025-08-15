import { ClaudeMessagesRequest, ClaudeMessage } from '../models/claude.js';
import { ModelManager } from '../core/model-manager.js';
import { truncateContent, safeJsonStringify } from './shared-converters.js';

const MAX_TOTAL_REQUEST_SIZE = 800000; // Reduce to ~800KB to avoid OpenAI 413

export function convertClaudeToOpenAI(
  request: ClaudeMessagesRequest,
  modelManager: ModelManager,
  options?: { maxTotalRequestSize?: number }
): any {
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

  const convertedMessages = convertMessages(request.messages);
  
  // Prioritize keeping the system message and the most recent messages
  const limit = options?.maxTotalRequestSize ?? MAX_TOTAL_REQUEST_SIZE;
  const finalMessages = [];
  let currentSize = JSON.stringify({ ...openaiRequest, messages: [] }).length;

  // Always include the system message if it exists and fits
  const systemMessage = openaiRequest.messages.find((m: any) => m.role === 'system');
  if (systemMessage) {
    const systemMessageSize = JSON.stringify(systemMessage).length;
    if (currentSize + systemMessageSize <= limit) {
      finalMessages.push(systemMessage);
      currentSize += systemMessageSize;
    } else {
      console.warn('System message is too large to fit within the budget.');
    }
  }

  // Add messages from newest to oldest until the budget is full
  for (let i = convertedMessages.length - 1; i >= 0; i--) {
    const message = convertedMessages[i];
    const messageSize = JSON.stringify(message).length;

    if (currentSize + messageSize > limit) {
      console.warn(`Request budget reached. Truncating older messages. Kept ${finalMessages.length - (systemMessage ? 1 : 0)} of ${convertedMessages.length} messages.`);
      break; // Stop adding messages if budget is exceeded
    }

    finalMessages.splice(systemMessage ? 1 : 0, 0, message); // Insert after system message
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