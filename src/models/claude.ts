export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContent[];
}

export interface ClaudeContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  // Tool use fields
  id?: string;
  name?: string;
  input?: any;
  // Tool result fields
  tool_use_id?: string;
  content?: any;
}

export interface ClaudeSystemMessage {
  type: 'text';
  text: string;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: any;
}

export interface ClaudeMessagesRequest {
  model: string;
  max_tokens: number;
  messages: ClaudeMessage[];
  system?: string | ClaudeSystemMessage[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  stop_sequences?: string[];
  tools?: ClaudeTool[];
}

export interface ClaudeTokenCountRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string | ClaudeSystemMessage[];
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ClaudeContent[];
  model: string;
  stop_reason: string;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeStreamEvent {
  type: string;
  [key: string]: any;
}