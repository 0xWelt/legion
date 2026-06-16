export interface Workdir {
  id: string;
  name: string;
  path: string;
  defaultAgent?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  name: string;
  workdirId: string;
  type: 'main' | 'thread';
  agent: string;
  agentSessionId?: string;
  status: 'idle' | 'running' | 'error';
  createdAt: string;
  lastUsedAt: string;
}

export type AgentEvent =
  | TextEvent
  | ToolCallEvent
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
  workdirs: Record<string, Workdir>;
  sessions: Record<string, Session>;
}
