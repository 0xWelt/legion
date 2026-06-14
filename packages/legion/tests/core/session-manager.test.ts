import { describe, expect, it } from 'vitest';
import { InMemorySessionManager } from '../../src/core/session-manager.js';

describe('InMemorySessionManager', () => {
  it('creates main session with agent', () => {
    const manager = new InMemorySessionManager();
    const session = manager.createMain('123', 'main', 'wd-1', 'kimi-code');

    expect(session.id).toBe('123');
    expect(session.type).toBe('main');
    expect(session.workdirId).toBe('wd-1');
    expect(session.status).toBe('idle');
    expect(session.agent).toBe('kimi-code');
  });

  it('creates thread session with agent', () => {
    const manager = new InMemorySessionManager();
    const session = manager.createThread('456', 'fix-bug', 'wd-1', 'kimi-code-text');

    expect(session.id).toBe('456');
    expect(session.type).toBe('thread');
    expect(session.agent).toBe('kimi-code-text');
  });

  it('sets agent', () => {
    const manager = new InMemorySessionManager();
    manager.createMain('123', 'main', 'wd-1', 'kimi-code');
    manager.setAgent('123', 'kimi-code-text');

    expect(manager.get('123')?.agent).toBe('kimi-code-text');
  });

  it('sets agent session id', () => {
    const manager = new InMemorySessionManager();
    manager.createMain('123', 'main', 'wd-1', 'kimi-code');
    manager.setAgentSessionId('123', 'agent-sid-1');

    expect(manager.get('123')?.agentSessionId).toBe('agent-sid-1');
  });

  it('lists sessions by workdir', () => {
    const manager = new InMemorySessionManager();
    manager.createMain('1', 'main', 'wd-a', 'kimi-code');
    manager.createThread('2', 't1', 'wd-a', 'kimi-code');
    manager.createThread('3', 't2', 'wd-b', 'kimi-code-text');

    expect(manager.listByWorkdir('wd-a')).toHaveLength(2);
    expect(manager.listByWorkdir('wd-b')).toHaveLength(1);
  });
});
