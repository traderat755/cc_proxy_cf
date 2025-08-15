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

  // Convert messages with proper tool call/result handling
  const messages = request.messages;
  let i = 0;
  
  while (i < messages.length) {
    const message = messages[i];
    const openaiMessage = convertClaudeMessage(message);
    
    if (openaiMessage) {
      openaiRequest.messages.push(openaiMessage);
      
      // If this is an assistant message with tool calls, check for tool results in next message
      if (message.role === 'assistant' && openaiMessage.tool_calls) {
        const toolCallIds = new Set(openaiMessage.tool_calls.map((tc: any) => tc.id));
        
        // Check if next message contains tool results
        if (i + 1 < messages.length) {
          const nextMessage = messages[i + 1];
          if (nextMessage.role === 'user' && Array.isArray(nextMessage.content)) {
            const toolResults = nextMessage.content.filter(block => block.type === 'tool_result');
            
            if (toolResults.length > 0) {
              // Convert tool results to OpenAI format
              const toolMessages = toolResults.map(result => ({
                role: 'tool' as const,
                tool_call_id: result.tool_use_id as string,
                content: formatToolResultContent(result.content)
              }));
              
              // Track which tool calls have responses
              const respondedToolIds = new Set(toolMessages.map(tm => tm.tool_call_id));
              
              // Add tool result messages
              openaiRequest.messages.push(...toolMessages);
              
              // Create dummy responses for any missing tool calls
              for (const toolCallId of toolCallIds) {
                if (!respondedToolIds.has(toolCallId as string)) {
                  console.warn(`Missing tool result for tool_call_id: ${toolCallId}, creating dummy response`);
                  openaiRequest.messages.push({
                    role: 'tool' as const,
                    tool_call_id: toolCallId as string,
                    content: 'Tool execution completed without explicit result.'
                  });
                }
              }
              
              // Skip the tool result message since we processed it
              i++;
            } else {
              // No tool results found, create dummy responses for all tool calls
              console.warn(`No tool results found for ${toolCallIds.size} tool calls, creating dummy responses`);
              for (const toolCallId of toolCallIds) {
                openaiRequest.messages.push({
                  role: 'tool' as const,
                  tool_call_id: toolCallId as string,
                  content: 'Tool execution completed without explicit result.'
                });
              }
            }
          } else {
            // Next message is not a user message with tool results, create dummy responses
            console.warn(`Expected tool results but next message doesn't contain them, creating dummy responses for ${toolCallIds.size} tool calls`);
            for (const toolCallId of toolCallIds) {
              openaiRequest.messages.push({
                role: 'tool',
                tool_call_id: toolCallId as string,
                content: 'Tool execution completed without explicit result.'
              });
            }
          }
        } else {
          // No next message, create dummy responses for all tool calls
          console.warn(`No next message found after tool calls, creating dummy responses for ${toolCallIds.size} tool calls`);
          for (const toolCallId of toolCallIds) {
            openaiRequest.messages.push({
              role: 'tool',
              tool_call_id: toolCallId as string,
              content: 'Tool execution completed without explicit result.'
            });
          }
        }
      }
    }
    
    i++;
  }

  return openaiRequest;
}

function formatToolResultContent(content: any): string {
  if (content === null || content === undefined) {
    return 'No content provided';
  }
  
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    const resultParts = [];
    for (const item of content) {
      if (typeof item === 'object' && item.type === 'text' && item.text) {
        resultParts.push(item.text);
      } else if (typeof item === 'string') {
        resultParts.push(item);
      } else {
        try {
          resultParts.push(JSON.stringify(item));
        } catch {
          resultParts.push(String(item));
        }
      }
    }
    return resultParts.join('\n').trim();
  }
  
  if (typeof content === 'object') {
    if (content.type === 'text' && content.text) {
      return content.text;
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  
  try {
    return String(content);
  } catch {
    return 'Unparseable content';
  }
}

function convertClaudeMessage(message: ClaudeMessage): any {
  // Handle null or undefined content
  if (message.content === null || message.content === undefined) {
    return {
      role: message.role,
      content: message.role === 'assistant' ? null : ''
    };
  }

  if (typeof message.content === 'string') {
    return {
      role: message.role,
      content: message.content
    };
  }

  if (Array.isArray(message.content)) {
    const content: any[] = [];
    const textParts: string[] = [];
    const toolCalls: any[] = [];
    
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        if (message.role === 'assistant') {
          textParts.push(block.text);
        } else {
          content.push({
            type: 'text',
            text: block.text
          });
        }
      } else if (block.type === 'image' && block.source) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`
          }
        });
      } else if (block.type === 'tool_use' && message.role === 'assistant') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {})
          }
        });
      }
    }

    // For assistant messages, handle text and tool calls separately
    if (message.role === 'assistant') {
      const openaiMessage: any = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null
      };
      
      if (toolCalls.length > 0) {
        openaiMessage.tool_calls = toolCalls;
      }
      
      return openaiMessage;
    }

    // For user messages
    if (content.length > 0) {
      // If only one text block, return as string
      if (content.length === 1 && content[0].type === 'text') {
        return {
          role: message.role,
          content: content[0].text
        };
      }
      
      return {
        role: message.role,
        content: content
      };
    }
    
    // If no valid content blocks found
    return {
      role: message.role,
      content: ''
    };
  }

  // Fallback for any other case
  return {
    role: message.role,
    content: message.role === 'assistant' ? null : ''
  };
}