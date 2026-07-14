import { describe, expect, it } from 'vitest';
import { DefaultAgentRunnerFactory } from '@0xwelt/legion-api';
import { InMemorySessionManager } from '../../src/core/session-manager.js';
import { LegionMessageRouter } from '../../src/core/message-router.js';
import type { IMMessage } from '../../src/im/types.js';

function makeMsg(overrides: Partial<IMMessage> = {}): IMMessage {
  return {
    id: 'msg-1',
    provider: 'discord',
    sessionId: 'session-1',
    authorId: 'user-1',
    authorName: 'tester',
    content: 'hello',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('LegionMessageRouter', () => {
  function makeRouter(sessions: InMemorySessionManager) {
    const factory = new DefaultAgentRunnerFactory();
    return new LegionMessageRouter({
      sessionManager: sessions,
      runnerFactory: factory,
      defaultAgent: 'kimi-code',
    });
  }

  it('returns prompt route when session has path', async () => {
    const sessions = new InMemorySessionManager();
    const router = makeRouter(sessions);

    const session = sessions.create('session-1', 'discord', 'main', 'kimi-code');
    sessions.setPath(session.id, '/tmp/repo-a');

    const route = await router.route(makeMsg({ content: 'write tests' }));
    expect(route.type).toBe('prompt');
    expect(route.prompt).toBe('write tests');
    expect(route.session.provider).toBe('discord');
    expect(route.session.agent).toBe('kimi-code');
  });

  it('returns command route for /workdir', async () => {
    const sessions = new InMemorySessionManager();
    const router = makeRouter(sessions);

    const route = await router.route(makeMsg({ content: '/workdir /tmp/repo-b' }));
    expect(route.type).toBe('command');
    expect(route.command).toEqual({ type: 'workdir', path: '/tmp/repo-b' });
  });

  it('rejects prompt when session has no path', async () => {
    const sessions = new InMemorySessionManager();
    const router = makeRouter(sessions);

    const route = await router.route(makeMsg({ content: 'hello' }));
    expect(route.response).toContain('尚未绑定 workdir');
  });

  it('allows /help before workdir is bound', async () => {
    const sessions = new InMemorySessionManager();
    const router = makeRouter(sessions);

    const route = await router.route(makeMsg({ content: '/help' }));
    expect(route.type).toBe('command');
    expect(route.command).toEqual({ type: 'help' });
    expect(route.response).toBeUndefined();
  });

  it('reuses existing session', async () => {
    const sessions = new InMemorySessionManager();
    const router = makeRouter(sessions);

    const first = await router.route(makeMsg({ content: 'first' }));
    sessions.setPath(first.session.id, '/tmp/repo');

    const second = await router.route(makeMsg({ content: 'second' }));
    expect(second.type).toBe('prompt');
    expect(second.session.id).toBe(first.session.id);
  });

  it('keeps existing session agent when global default changes', async () => {
    const sessions = new InMemorySessionManager();
    const routerOld = makeRouter(sessions);
    const first = await routerOld.route(makeMsg({ content: 'first' }));
    expect(first.session.agent).toBe('kimi-code');

    const factory = new DefaultAgentRunnerFactory();
    const routerNew = new LegionMessageRouter({
      sessionManager: sessions,
      runnerFactory: factory,
      defaultAgent: 'claude-code',
    });

    const second = await routerNew.route(makeMsg({ content: 'second' }));
    expect(second.session.agent).toBe('kimi-code');
    expect(second.session.id).toBe(first.session.id);
  });
});
