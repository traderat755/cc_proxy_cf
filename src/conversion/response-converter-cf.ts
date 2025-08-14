import { ClaudeResponse, ClaudeStreamEvent, ClaudeMessagesRequest } from '../models/claude.js';
import { convertOpenAIToClaudeResponse as sharedConvert, mapOpenAIFinishReason, createStreamingEvents } from './shared-converters.js';

export function convertOpenAIToClaudeResponse(openaiResponse: any, originalRequest: ClaudeMessagesRequest): ClaudeResponse {
  return sharedConvert(openaiResponse, originalRequest);
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
  const events = createStreamingEvents(requestId, originalRequest);
  
  try {
    
    yield `event: message_start\ndata: ${JSON.stringify(events.messageStart())}\n\n`;
    yield `event: content_block_start\ndata: ${JSON.stringify(events.contentBlockStart())}\n\n`;

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
                
                yield `event: content_block_delta\ndata: ${JSON.stringify(events.contentBlockDelta(delta.content))}\n\n`;
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

    yield `event: content_block_stop\ndata: ${JSON.stringify(events.contentBlockStop())}\n\n`;
    yield `event: message_delta\ndata: ${JSON.stringify(events.messageDelta(stopReason, outputTokens))}\n\n`;
    yield `event: message_stop\ndata: ${JSON.stringify(events.messageStop())}\n\n`;

  } catch (error: any) {
    logger.error(`Streaming error: ${error.message}`);
    
    yield `event: error\ndata: ${JSON.stringify(events.error(openaiClient.classifyOpenAIError(error.message)))}\n\n`;
  }
}

