import { ClaudeResponse, ClaudeMessagesRequest } from '../models/claude';
import { convertOpenAIToClaudeResponse as sharedConvert, mapOpenAIFinishReason, createStreamingEvents, processToolCallDelta } from './shared-converters';

export function convertOpenAIToClaudeResponse(openaiResponse: any, originalRequest: ClaudeMessagesRequest): ClaudeResponse {
  return sharedConvert(openaiResponse, originalRequest);
}

export async function* convertOpenAIStreamingToClaudeWithCancellation(
  openaiStream: AsyncIterable<any> | ReadableStream,
  originalRequest: ClaudeMessagesRequest,
  logger: any,
  openaiClient: any,
  requestId: string
): AsyncGenerator<string> {
  let outputTokens = 0;
  let stopReason = 'end_turn';
  const events = createStreamingEvents(requestId, originalRequest);
  
  let textBlockIndex = 0;
  let toolBlockCounter = { value: 0 };
  const currentToolCalls: { [key: number]: {
    id: string | null;
    name: string | null;
    argsBuffer: string;
    jsonSent: boolean;
    claudeIndex: number | null;
    started: boolean;
  } } = {};
  
  try {
    
    yield `event: message_start\ndata: ${JSON.stringify(events.messageStart())}\n\n`;
    yield `event: content_block_start\ndata: ${JSON.stringify(events.contentBlockStart())}\n\n`;

    // Handle ReadableStream (Cloudflare Workers environment)
    if (openaiStream instanceof ReadableStream) {
      const reader = openaiStream.getReader();
      const decoder = new TextDecoder();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          
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
                
                // Handle text delta
                if (delta.content) {
                  outputTokens += 1;
                  
                  yield `event: content_block_delta\ndata: ${JSON.stringify(events.contentBlockDelta(delta.content))}\n\n`;
                }

                // Handle tool call deltas
                if (delta.tool_calls) {
                  for (const tcDelta of delta.tool_calls) {
                    const results = processToolCallDelta(tcDelta, currentToolCalls, events, textBlockIndex, toolBlockCounter);
                    for (const result of results) {
                      yield result;
                    }
                  }
                }

                if (choice.finish_reason) {
                  stopReason = mapOpenAIFinishReason(choice.finish_reason);
                  break;
                }
              } catch (parseError) {
                continue;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      // Handle AsyncIterable (Node.js environment)
      for await (const chunk of openaiStream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        
        // Handle text delta
        if (delta.content) {
          outputTokens += 1;
          
          yield `event: content_block_delta\ndata: ${JSON.stringify(events.contentBlockDelta(delta.content))}\n\n`;
        }

        // Handle tool call deltas
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const results = processToolCallDelta(tcDelta, currentToolCalls, events, textBlockIndex, toolBlockCounter);
            for (const result of results) {
              yield result;
            }
          }
        }

        if (choice.finish_reason) {
          stopReason = mapOpenAIFinishReason(choice.finish_reason);
          break;
        }
      }
    }

    // Send final SSE events
    yield `event: content_block_stop\ndata: ${JSON.stringify(events.contentBlockStop())}\n\n`;

    // Stop tool use blocks
    for (const toolData of Object.values(currentToolCalls)) {
      if (toolData.started && toolData.claudeIndex !== null) {
        yield `event: content_block_stop\ndata: ${JSON.stringify(events.toolUseStop(toolData.claudeIndex))}\n\n`;
      }
    }

    yield `event: message_delta\ndata: ${JSON.stringify(events.messageDelta(stopReason, outputTokens))}\n\n`;
    yield `event: message_stop\ndata: ${JSON.stringify(events.messageStop())}\n\n`;

  } catch (error: any) {
    logger.error(`Streaming error: ${error.message}`);
    
    yield `event: error\ndata: ${JSON.stringify(events.error(openaiClient.classifyOpenAIError(error.message)))}\n\n`;
  }
}

