import type { Session } from './types.js';

export interface SessionManager {
  get(id: string): Session | undefined;
  create(sessionId: string, provider: string, name: string, agent: string): Session;
  fork(parentSessionId: string, childSessionId: string, name?: string): Session | undefined;
  setPath(sessionId: string, path: string): void;
  setAgent(sessionId: string, agent: string): void;
  setAgentSessionId(sessionId: string, agentSessionId: string): void;
  setStatus(sessionId: string, status: Session['status']): void;
  touch(sessionId: string): void;
  list(): Session[];
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

  create(sessionId: string, provider: string, name: string, agent: string): Session {
    const session = this.makeSession(sessionId, provider, name, agent);
    this.sessions.set(sessionId, session);
    return session;
  }

  fork(parentSessionId: string, childSessionId: string, name?: string): Session | undefined {
    const parent = this.sessions.get(parentSessionId);
    if (!parent) {
      return undefined;
    }

    const now = new Date().toISOString();
    const child: Session = {
      ...parent,
      id: childSessionId,
      name: name ?? `${parent.name}-fork`,
      agentSessionId: undefined,
      status: 'idle',
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(childSessionId, child);
    return child;
  }

  setPath(sessionId: string, path: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.path = path;
      session.lastUsedAt = new Date().toISOString();
    }
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

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  load(state: Record<string, Session>): void {
    this.sessions = new Map(Object.entries(state));
  }

  dump(): Record<string, Session> {
    return Object.fromEntries(this.sessions);
  }

  private makeSession(sessionId: string, provider: string, name: string, agent: string): Session {
    const now = new Date().toISOString();
    return {
      id: sessionId,
      provider,
      name,
      path: '',
      agent,
      status: 'idle',
      createdAt: now,
      lastUsedAt: now,
    };
  }
}
