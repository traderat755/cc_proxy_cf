import { ClaudeResponse, ClaudeStreamEvent, ClaudeMessagesRequest } from '../models/claude';

export function convertOpenAIToClaudeResponse(openaiResponse: any, originalRequest: ClaudeMessagesRequest): ClaudeResponse {
  const choice = openaiResponse.choices[0];
  const message = choice.message;
  
  // Build Claude content blocks
  const contentBlocks: any[] = [];
  
  // Add text content
  const textContent = message.content;
  if (textContent !== null && textContent !== undefined) {
    contentBlocks.push({
      type: 'text',
      text: textContent
    });
  }
  
  // Add tool calls
  const toolCalls = message.tool_calls || [];
  for (const toolCall of toolCalls) {
    if (toolCall.type === 'function') {
      const functionData = toolCall.function;
      let arguments_;
      try {
        arguments_ = JSON.parse(functionData.arguments || '{}');
      } catch {
        arguments_ = { raw_arguments: functionData.arguments || '' };
      }
      
      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id || `tool_${Math.random().toString(36).substr(2, 9)}`,
        name: functionData.name || '',
        input: arguments_
      });
    }
  }
  
  // Ensure at least one content block
  if (contentBlocks.length === 0) {
    contentBlocks.push({
      type: 'text',
      text: ''
    });
  }
  
  return {
    id: openaiResponse.id,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model: originalRequest.model,
    stop_reason: mapOpenAIFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

export function mapOpenAIFinishReason(finishReason: string): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

// Content size limits (tightened to reduce overall payload size)
const MAX_CONTENT_LENGTH = 200000; // 200KB
const MAX_TOOL_ARGS_LENGTH = 50000; // 50KB

export function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_LENGTH) {
    return content;
  }
  return content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
}

export function safeJsonStringify(obj: any, maxLength: number = MAX_TOOL_ARGS_LENGTH): string {
  try {
    const str = JSON.stringify(obj);
    if (str.length > maxLength) {
      if (typeof obj === 'object' && obj !== null) {
        const truncated = { ...obj };
        for (const key in truncated) {
          const keyStr = JSON.stringify(truncated[key]);
          if (keyStr.length > maxLength / 2) {
            truncated[key] = '[truncated]';
          }
        }
        const newStr = JSON.stringify(truncated);
        return newStr.length > maxLength ? '{}' : newStr;
      }
      return '{}';
    }
    return str;
  } catch {
    return '{}';
  }
}

export function processToolCallDelta(
  tcDelta: any, 
  currentToolCalls: any, 
  events: any, 
  textBlockIndex: number, 
  toolBlockCounter: { value: number }
): string[] {
  const results: string[] = [];
  const tcIndex = tcDelta.index || 0;
  
  if (!(tcIndex in currentToolCalls)) {
    currentToolCalls[tcIndex] = {
      id: null,
      name: null,
      argsBuffer: '',
      jsonSent: false,
      claudeIndex: null,
      started: false
    };
  }
  
  const toolCall = currentToolCalls[tcIndex];
  
  if (tcDelta.id) {
    toolCall.id = tcDelta.id;
  }
  
  const functionData = tcDelta.function;
  if (functionData?.name) {
    toolCall.name = functionData.name;
  }
  
  if (toolCall.id && toolCall.name && !toolCall.started) {
    toolBlockCounter.value += 1;
    const claudeIndex = textBlockIndex + toolBlockCounter.value;
    toolCall.claudeIndex = claudeIndex;
    toolCall.started = true;
    
    results.push(`event: content_block_start\ndata: ${JSON.stringify(events.toolUseStart(claudeIndex, toolCall.id, toolCall.name))}\n\n`);
  }
  
  if (functionData?.arguments !== undefined && toolCall.started && functionData.arguments !== null) {
    toolCall.argsBuffer += functionData.arguments;
    
    try {
      JSON.parse(toolCall.argsBuffer);
      if (!toolCall.jsonSent && toolCall.claudeIndex !== null) {
        results.push(`event: content_block_delta\ndata: ${JSON.stringify(events.toolUseDelta(toolCall.claudeIndex, toolCall.argsBuffer))}\n\n`);
        toolCall.jsonSent = true;
      }
    } catch {
      // JSON incomplete, continue accumulating
    }
  }
  
  return results;
}

export function createStreamingEvents(requestId: string, originalRequest: ClaudeMessagesRequest) {
  return {
    messageStart: (): ClaudeStreamEvent => ({
      type: 'message_start',
      message: {
        id: `msg_${requestId}`,
        type: 'message',
        role: 'assistant',
        content: [],
        model: originalRequest.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      }
    }),

    contentBlockStart: (): ClaudeStreamEvent => ({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: ''
      }
    }),

    contentBlockDelta: (text: string): ClaudeStreamEvent => ({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: text
      }
    }),

    toolUseStart: (index: number, id: string, name: string): ClaudeStreamEvent => ({
      type: 'content_block_start',
      index: index,
      content_block: {
        type: 'tool_use',
        id: id,
        name: name,
        input: {}
      }
    }),

    toolUseDelta: (index: number, partialJson: string): ClaudeStreamEvent => ({
      type: 'content_block_delta',
      index: index,
      delta: {
        type: 'input_json_delta',
        partial_json: partialJson
      }
    }),

    toolUseStop: (index: number): ClaudeStreamEvent => ({
      type: 'content_block_stop',
      index: index
    }),

    contentBlockStop: (): ClaudeStreamEvent => ({
      type: 'content_block_stop',
      index: 0
    }),

    messageDelta: (stopReason: string, outputTokens: number): ClaudeStreamEvent => ({
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null
      },
      usage: {
        output_tokens: outputTokens
      }
    }),

    messageStop: (): ClaudeStreamEvent => ({
      type: 'message_stop'
    }),

    error: (errorMessage: string): ClaudeStreamEvent => ({
      type: 'error',
      error: {
        type: 'api_error',
        message: errorMessage
      }
    })
  };
}