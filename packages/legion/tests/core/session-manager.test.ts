import { describe, expect, it } from 'vitest';
import { InMemorySessionManager } from '../../src/core/session-manager.js';

describe('InMemorySessionManager', () => {
  it('creates session with agent', () => {
    const manager = new InMemorySessionManager();
    const session = manager.create('123', 'test', 'main', 'kimi-code');

    expect(session.id).toBe('123');
    expect(session.provider).toBe('test');
    expect(session.name).toBe('main');
    expect(session.path).toBe('');
    expect(session.status).toBe('idle');
    expect(session.agent).toBe('kimi-code');
  });

  it('sets path', () => {
    const manager = new InMemorySessionManager();
    manager.create('123', 'test', 'main', 'kimi-code');
    manager.setPath('123', '/tmp/repo');

    expect(manager.get('123')?.path).toBe('/tmp/repo');
  });

  it('sets agent', () => {
    const manager = new InMemorySessionManager();
    manager.create('123', 'test', 'main', 'kimi-code');
    manager.setAgent('123', 'claude-code');

    expect(manager.get('123')?.agent).toBe('claude-code');
  });

  it('sets agent session id', () => {
    const manager = new InMemorySessionManager();
    manager.create('123', 'test', 'main', 'kimi-code');
    manager.setAgentSessionId('123', 'agent-sid-1');

    expect(manager.get('123')?.agentSessionId).toBe('agent-sid-1');
  });

  it('forks session from parent inheriting path and agent', () => {
    const manager = new InMemorySessionManager();
    manager.create('parent', 'test', 'main', 'kimi-code');
    manager.setPath('parent', '/tmp/repo');
    manager.setAgentSessionId('parent', 'agent-sid-1');

    const child = manager.fork('parent', 'child', 'thread-a');

    expect(child).toBeDefined();
    expect(child!.id).toBe('child');
    expect(child!.provider).toBe('test');
    expect(child!.name).toBe('thread-a');
    expect(child!.path).toBe('/tmp/repo');
    expect(child!.agent).toBe('kimi-code');
    expect(child!.agentSessionId).toBeUndefined();
    expect(child!.status).toBe('idle');
  });

  it('returns undefined when forking from unknown parent', () => {
    const manager = new InMemorySessionManager();
    expect(manager.fork('unknown', 'child')).toBeUndefined();
  });
});
