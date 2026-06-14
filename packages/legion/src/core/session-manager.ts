import type { Session } from './types.js';

export interface SessionManager {
  get(id: string): Session | undefined;
  createMain(sessionId: string, name: string, workdirId: string, agent: string): Session;
  createThread(sessionId: string, name: string, workdirId: string, agent: string): Session;
  setAgentSessionId(sessionId: string, agentSessionId: string): void;
  setStatus(sessionId: string, status: Session['status']): void;
  touch(sessionId: string): void;
  listByWorkdir(workdirId: string): Session[];
}

export class InMemorySessionManager implements SessionManager {
  private sessions: Map<string, Session> = new Map();

  constructor(initial: Record<string, Session> = {}) {
    for (const [id, session] of Object.entries(initial)) {
      this.sessions.set(id, session);
    }
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  createMain(sessionId: string, name: string, workdirId: string, agent: string): Session {
    const session = this.makeSession(sessionId, name, workdirId, 'main', agent);
    this.sessions.set(sessionId, session);
    return session;
  }

  createThread(sessionId: string, name: string, workdirId: string, agent: string): Session {
    const session = this.makeSession(sessionId, name, workdirId, 'thread', agent);
    this.sessions.set(sessionId, session);
    return session;
  }

  setAgent(sessionId: string, agent: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.agent = agent;
      session.lastUsedAt = new Date().toISOString();
    }
  }

  setAgentSessionId(sessionId: string, agentSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.agentSessionId = agentSessionId;
      session.lastUsedAt = new Date().toISOString();
    }
  }

  setStatus(sessionId: string, status: Session['status']): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.lastUsedAt = new Date().toISOString();
    }
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastUsedAt = new Date().toISOString();
    }
  }

  listByWorkdir(workdirId: string): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.workdirId === workdirId);
  }

  load(state: Record<string, Session>): void {
    this.sessions = new Map(Object.entries(state));
  }

  dump(): Record<string, Session> {
    return Object.fromEntries(this.sessions);
  }

  private makeSession(
    sessionId: string,
    name: string,
    workdirId: string,
    type: Session['type'],
    agent: string
  ): Session {
    const now = new Date().toISOString();
    return {
      id: sessionId,
      name,
      workdirId,
      type,
      agent,
      status: 'idle',
      createdAt: now,
      lastUsedAt: now,
    };
  }
}
