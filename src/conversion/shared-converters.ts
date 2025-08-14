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

export function mapOpenAIFinishReason(finishReason: string): string {
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