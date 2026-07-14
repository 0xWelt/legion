export interface Session {
  id: string;
  provider: string;
  name: string;
  path: string;
  agent: string;
  status: 'idle' | 'running' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionId: string;
}
