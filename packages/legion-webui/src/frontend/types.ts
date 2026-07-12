export interface Workdir {
  id: string;
  name: string;
  path: string;
  defaultAgent?: string;
}

export interface Session {
  id: string;
  name: string;
  workdirId: string;
  type: 'main' | 'thread';
  agent: string;
  status: 'idle' | 'running' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  channelId: string;
  threadId?: string;
}
