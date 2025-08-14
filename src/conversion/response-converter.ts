import { ClaudeResponse, ClaudeStreamEvent, ClaudeMessagesRequest } from '../models/claude.js';
import { convertOpenAIToClaudeResponse as sharedConvert, mapOpenAIFinishReason, createStreamingEvents } from './shared-converters.js';

export function convertOpenAIToClaudeResponse(openaiResponse: any, originalRequest: ClaudeMessagesRequest): ClaudeResponse {
  return sharedConvert(openaiResponse, originalRequest);
}

export async function* convertOpenAIStreamingToClaudeWithCancellation(
  openaiStream: AsyncIterable<any>,
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

    for await (const chunk of openaiStream) {
      // Note: Client disconnection check not available in Hono streaming
      // The framework will handle disconnections automatically

      const choice = chunk.choices[0];
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
    }

    yield `event: content_block_stop\ndata: ${JSON.stringify(events.contentBlockStop())}\n\n`;
    yield `event: message_delta\ndata: ${JSON.stringify(events.messageDelta(stopReason, outputTokens))}\n\n`;
    yield `event: message_stop\ndata: ${JSON.stringify(events.messageStop())}\n\n`;

  } catch (error: any) {
    logger.error(`Streaming error: ${error.message}`);
    
    yield `event: error\ndata: ${JSON.stringify(events.error(openaiClient.classifyOpenAIError(error.message)))}\n\n`;
  }
}

