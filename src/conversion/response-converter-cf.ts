import { ClaudeResponse, ClaudeStreamEvent, ClaudeMessagesRequest } from '../models/claude.js';

export function convertOpenAIToClaudeResponse(openaiResponse: any, originalRequest: ClaudeMessagesRequest): ClaudeResponse {
  const choice = openaiResponse.choices[0];
  const message = choice.message;
  
  return {
    id: openaiResponse.id,
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: message.content || ''
      }
    ],
    model: originalRequest.model,
    stop_reason: mapOpenAIFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

export async function* convertOpenAIStreamingToClaudeWithCancellation(
  openaiStream: ReadableStream,
  originalRequest: ClaudeMessagesRequest,
  logger: any,
  httpRequest: any,
  openaiClient: any,
  requestId: string
): AsyncGenerator<string> {
  let fullContent = '';
  let outputTokens = 0;
  let stopReason = 'end_turn';
  
  try {
    // Send message_start event
    const messageStartEvent: ClaudeStreamEvent = {
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
    };
    
    yield `event: message_start\ndata: ${JSON.stringify(messageStartEvent)}\n\n`;

    // Send content_block_start event
    const contentBlockStartEvent: ClaudeStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: ''
      }
    };
    
    yield `event: content_block_start\ndata: ${JSON.stringify(contentBlockStartEvent)}\n\n`;

    // Create a reader from the ReadableStream
    const reader = openaiStream.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        
        // Process SSE format data
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              break;
            }
            
            try {
              const jsonData = JSON.parse(data);
              const choice = jsonData.choices[0];
              if (!choice) continue;

              const delta = choice.delta;
              
              if (delta.content) {
                fullContent += delta.content;
                outputTokens += 1; // Rough estimation
                
                // Send content_block_delta event
                const contentBlockDeltaEvent: ClaudeStreamEvent = {
                  type: 'content_block_delta',
                  index: 0,
                  delta: {
                    type: 'text_delta',
                    text: delta.content
                  }
                };
                
                yield `event: content_block_delta\ndata: ${JSON.stringify(contentBlockDeltaEvent)}\n\n`;
              }

              if (choice.finish_reason) {
                stopReason = mapOpenAIFinishReason(choice.finish_reason);
                break;
              }
            } catch (parseError) {
              // Skip non-JSON lines
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Send content_block_stop event
    const contentBlockStopEvent: ClaudeStreamEvent = {
      type: 'content_block_stop',
      index: 0
    };
    
    yield `event: content_block_stop\ndata: ${JSON.stringify(contentBlockStopEvent)}\n\n`;

    // Send message_delta event with usage
    const messageDeltaEvent: ClaudeStreamEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null
      },
      usage: {
        output_tokens: outputTokens
      }
    };
    
    yield `event: message_delta\ndata: ${JSON.stringify(messageDeltaEvent)}\n\n`;

    // Send message_stop event
    const messageStopEvent: ClaudeStreamEvent = {
      type: 'message_stop'
    };
    
    yield `event: message_stop\ndata: ${JSON.stringify(messageStopEvent)}\n\n`;

  } catch (error: any) {
    logger.error(`Streaming error: ${error.message}`);
    
    const errorEvent: ClaudeStreamEvent = {
      type: 'error',
      error: {
        type: 'api_error',
        message: openaiClient.classifyOpenAIError(error.message)
      }
    };
    
    yield `event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`;
  }
}

function mapOpenAIFinishReason(finishReason: string): string {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}