export interface Session {
  id: string;
  provider: string;
  name: string;
  path: string;
  agent: string;
  status: 'idle' | 'running' | 'error';
}

export interface OutputSegment {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'error';
  content?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  message?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionId: string;
  segments?: OutputSegment[];
}

export interface AgentConfig {
  binary?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface IMProviderStatus {
  configured: boolean;
  summary: string;
}

export interface LegionConfig {
  defaultAgent?: string;
  stateStore?: { path: string };
  agents?: Record<string, AgentConfig>;
  [provider: string]: unknown;
}
