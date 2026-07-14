export interface Session {
  id: string;
  provider: string;
  name: string;
  path: string;
  agent: string;
  agentSessionId?: string;
  status: 'idle' | 'running' | 'error';
  createdAt: string;
  lastUsedAt: string;
}

export type AgentEvent =
  | TextEvent
  | ToolCallEvent
  | ToolCallDeltaEvent
  | ToolResultEvent
  | ThinkingEvent
  | SessionInitEvent
  | UsageEvent
  | ErrorEvent
  | CompleteEvent;

export interface TextEvent {
  type: 'text';
  text: string;
  delta?: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  toolId: string;
  toolName: string;
  input: unknown;
}

export interface ToolCallDeltaEvent {
  type: 'tool_call_delta';
  toolId: string;
  toolName: string;
  partialInput: string;
  delta: string;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolId: string;
  output: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  text: string;
  delta?: string;
}

export interface SessionInitEvent {
  type: 'session_init';
  agentSessionId: string;
}

export interface UsageEvent {
  type: 'usage';
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  fatal: boolean;
}

export interface CompleteEvent {
  type: 'complete';
  exitCode: number;
}

export interface LegionState {
  sessions: Record<string, Session>;
}
