import { describe, expect, it } from 'vitest';
import { DefaultAgentRunnerFactory } from '../../src/agent/factory.js';
import { InMemorySessionManager } from '../../src/core/session-manager.js';
import { LegionMessageRouter } from '../../src/core/message-router.js';
import { InMemoryWorkdirManager } from '../../src/core/workdir-manager.js';
import type { IMMessage, IMThread } from '../../src/im/types.js';

function makeMsg(overrides: Partial<IMMessage> = {}): IMMessage {
  return {
    id: 'msg-1',
    provider: 'discord',
    channelId: 'channel-1',
    authorId: 'user-1',
    authorName: 'tester',
    content: 'hello',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeThread(overrides: Partial<IMThread> = {}): IMThread {
  return {
    id: 'thread-1',
    provider: 'discord',
    channelId: 'channel-1',
    name: 'fix-bug',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('LegionMessageRouter', () => {
  function makeRouter(workdirs: InMemoryWorkdirManager, sessions: InMemorySessionManager) {
    const factory = new DefaultAgentRunnerFactory();
    return new LegionMessageRouter({
      workdirManager: workdirs,
      sessionManager: sessions,
      runnerFactory: factory,
      defaultAgent: 'kimi-code',
    });
  }

  it('returns prompt route when workdir bound', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    const router = makeRouter(workdirs, sessions);

    workdirs.bind('channel-1', 'repo-a', '/tmp/repo-a', 'kimi-code');

    const route = await router.route(makeMsg({ content: 'write tests' }));
    expect(route.type).toBe('prompt');
    expect(route.prompt).toBe('write tests');
    expect(route.session.workdirId).toBe('channel-1');
    expect(route.session.agent).toBe('kimi-code');
  });

  it('returns command route for /workdir', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    const router = makeRouter(workdirs, sessions);

    workdirs.bind('channel-1', 'repo-a', '/tmp/repo-a', 'kimi-code');

    const route = await router.route(makeMsg({ content: '/workdir /tmp/repo-b' }));
    expect(route.type).toBe('command');
    expect(route.command).toEqual({ type: 'workdir', path: '/tmp/repo-b' });
  });

  it('rejects prompt when workdir not bound', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    const router = makeRouter(workdirs, sessions);

    const route = await router.route(makeMsg({ content: 'hello' }));
    expect(route.response).toContain('尚未绑定 workdir');
  });

  it('allows /help before workdir is bound', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    const router = makeRouter(workdirs, sessions);

    const route = await router.route(makeMsg({ content: '/help' }));
    expect(route.type).toBe('command');
    expect(route.command).toEqual({ type: 'help' });
    expect(route.response).toBeUndefined();
  });

  it('creates thread session on thread create', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    workdirs.bind('channel-1', 'repo-a', '/tmp/repo-a', 'claude-code');

    const router = makeRouter(workdirs, sessions);

    await router.onThreadCreate(makeThread());
    const session = sessions.get('thread-1');
    expect(session).toBeDefined();
    expect(session?.type).toBe('thread');
    expect(session?.agent).toBe('claude-code');
  });

  it('inherits agent from global default when workdir defaultAgent is unset', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    workdirs.bind('channel-1', 'repo-a', '/tmp/repo-a');

    const router = makeRouter(workdirs, sessions);

    const route = await router.route(makeMsg({ content: 'write tests' }));
    expect(route.type).toBe('prompt');
    expect(route.session.agent).toBe('kimi-code');
  });

  it('routes thread message to parent channel workdir', async () => {
    const workdirs = new InMemoryWorkdirManager();
    const sessions = new InMemorySessionManager();
    workdirs.bind('channel-1', 'repo-a', '/tmp/repo-a', 'kimi-code');

    const router = makeRouter(workdirs, sessions);

    await router.onThreadCreate(makeThread());
    const route = await router.route(
      makeMsg({ channelId: 'channel-1', threadId: 'thread-1', content: 'fix it' })
    );
    expect(route.type).toBe('prompt');
    expect(route.prompt).toBe('fix it');
    expect(route.session.workdirId).toBe('channel-1');
    expect(route.session.type).toBe('thread');
    expect(route.session.agent).toBe('kimi-code');
  });
});
