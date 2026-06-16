import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DefaultAgentRunnerFactory } from '../../src/agent/factory.js';
import type { AgentRunner } from '../../src/agent/types.js';
import type { LegionConfig } from '../../src/config/schema.js';
import { LegionCore } from '../../src/core/legion-core.js';
import type { AgentEvent } from '../../src/core/types.js';
import type {
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMTarget,
  IMThread,
  RenderState,
} from '../../src/im/types.js';
import { JsonStateStore } from '../../src/state/store.js';

let tempDir: string;

async function makeStore(): Promise<JsonStateStore> {
  tempDir = await mkdtemp(join(tmpdir(), 'legion-core-'));
  return new JsonStateStore({ path: join(tempDir, 'state.json') });
}

async function cleanupStore(): Promise<void> {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

class FakeProvider implements IMProvider {
  readonly name = 'fake';
  readonly sent: Array<{ target: IMTarget; text: string }> = [];
  readonly embeds: Array<{ target: IMTarget; embed: unknown }> = [];
  private handlers = {
    message: [] as Array<(msg: IMMessage) => void>,
    threadCreate: [] as Array<(thread: IMThread) => void>,
    threadDelete: [] as Array<(threadId: string) => void>,
    threadArchive: [] as Array<(threadId: string, archived: boolean) => void>,
  };

  async start(): Promise<void> {}

  onMessage(handler: (msg: IMMessage) => void): void {
    this.handlers.message.push(handler);
  }

  onThreadCreate(handler: (thread: IMThread) => void): void {
    this.handlers.threadCreate.push(handler);
  }

  onThreadDelete(handler: (threadId: string) => void): void {
    this.handlers.threadDelete.push(handler);
  }

  onThreadArchive(handler: (threadId: string, archived: boolean) => void): void {
    this.handlers.threadArchive.push(handler);
  }

  async sendText(target: IMTarget, text: string): Promise<IMMessageRef> {
    this.sent.push({ target, text });
    return {
      provider: this.name,
      channelId: target.channelId,
      threadId: target.threadId,
      messageId: 'm1',
    };
  }

  async editText(): Promise<void> {}
  async sendEmbed(target: IMTarget, embed: unknown): Promise<IMMessageRef> {
    this.embeds.push({ target, embed });
    return {
      provider: this.name,
      channelId: target.channelId,
      threadId: target.threadId,
      messageId: 'm2',
    };
  }
  async editEmbed(): Promise<void> {}
  async sendTyping(): Promise<void> {}

  async renderEvent(
    _target: IMTarget,
    event: AgentEvent,
    state: RenderState
  ): Promise<RenderState> {
    if (event.type === 'text') {
      state.replyMessageRef = await this.sendText(_target, event.text);
    }
    return state;
  }

  async emitMessage(msg: IMMessage): Promise<void> {
    await Promise.all(this.handlers.message.map((handler) => handler(msg)));
  }

  async emitThreadCreate(thread: { id: string; channelId: string; name: string }): Promise<void> {
    const imThread: IMThread = {
      ...thread,
      provider: this.name,
      createdAt: new Date(),
    };
    await Promise.all(this.handlers.threadCreate.map((handler) => handler(imThread)));
  }
}

class FakeRunner implements AgentRunner {
  readonly name = 'fake';
  private events: AgentEvent[];

  constructor(events: AgentEvent[] = []) {
    this.events = events;
  }

  async *run(): AsyncIterable<AgentEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async interrupt(): Promise<void> {}
  async kill(): Promise<void> {}
}

function makeConfig(runner: NonNullable<LegionConfig['defaultAgent']> = 'kimi-code'): LegionConfig {
  return {
    discord: { botToken: 'token', allowedGuildId: 'guild' },
    defaultAgent: runner,
    stateStore: { path: ':memory:' },
  };
}

function makeMsg(content: string, overrides: Partial<IMMessage> = {}): IMMessage {
  return {
    id: 'msg-1',
    provider: 'fake',
    channelId: 'ch-1',
    authorId: 'user-1',
    authorName: 'tester',
    content,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('LegionCore', () => {
  beforeEach(async () => {
    await makeStore();
  });

  afterEach(async () => {
    await cleanupStore();
  });

  it('handles /workdir command and binds workdir', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();

    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));

    expect(provider.sent).toContainEqual(
      expect.objectContaining({
        target: expect.objectContaining({ channelId: 'ch-1' }),
        text: `已绑定 workdir: ${tempDir}`,
      })
    );
  });

  it('rejects prompt without workdir binding', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();

    await provider.emitMessage(makeMsg('write code'));

    expect(provider.sent.some((s) => s.text.includes('尚未绑定 workdir'))).toBe(true);
  });

  it('runs agent on prompt and renders events', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    factory.register('kimi-code', () => new FakeRunner([{ type: 'text', text: 'done' }]));
    factory.register('kimi-code-text', () => new FakeRunner([{ type: 'text', text: 'done' }]));
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();

    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    await provider.emitMessage(makeMsg('write code'));

    expect(provider.sent.some((s) => s.text === 'done')).toBe(true);
  });

  it('selects runner based on defaultAgent config', async () => {
    for (const runner of ['kimi-code', 'kimi-code-text'] as const) {
      const provider = new FakeProvider();
      const factory = new DefaultAgentRunnerFactory();
      factory.register('kimi-code', () => new FakeRunner([{ type: 'text', text: 'json' }]));
      factory.register('kimi-code-text', () => new FakeRunner([{ type: 'text', text: 'text' }]));
      const store = new JsonStateStore({ path: join(tempDir, `state-${runner}.json`) });
      const core = new LegionCore({
        config: makeConfig(runner),
        imProvider: provider,
        runnerFactory: factory,
        stateStore: store,
      });
      await core.start();

      await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
      await provider.emitMessage(makeMsg('go'));

      const expected = runner === 'kimi-code' ? 'json' : 'text';
      expect(provider.sent.some((s) => s.text === expected)).toBe(true);
    }
  });

  it('persists workdir binding across restarts', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core1 = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core1.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));

    const provider2 = new FakeProvider();
    const core2 = new LegionCore({
      config: makeConfig(),
      imProvider: provider2,
      runnerFactory: factory,
      stateStore: store,
    });
    await core2.start();
    await provider2.emitMessage(makeMsg('/status'));

    expect(provider2.sent.some((s) => s.text.includes(tempDir))).toBe(true);
  });

  it('creates session on thread create without notification', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    const afterWorkdir = provider.sent.length;

    await provider.emitThreadCreate({ id: 'th-1', channelId: 'ch-1', name: 'fix-bug' });

    expect(provider.sent.length).toBe(afterWorkdir);
    expect(provider.sent.some((s) => s.text.includes('新的 Session'))).toBe(false);
  });

  it('sets session agent via /agent', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    factory.register('kimi-code', () => new FakeRunner([]));
    factory.register('kimi-code-text', () => new FakeRunner([]));
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    await provider.emitMessage(makeMsg('/agent kimi-code-text'));

    expect(provider.sent.some((s) => s.text === '已切换到 session agent: kimi-code-text')).toBe(
      true
    );
  });

  it('sets workdir agent via /agent --workdir', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    factory.register('kimi-code', () => new FakeRunner([]));
    factory.register('kimi-code-text', () => new FakeRunner([]));
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: makeConfig(),
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    await provider.emitMessage(makeMsg('/agent --workdir kimi-code-text'));

    expect(provider.sent.some((s) => s.text === '已设置 workdir 默认 agent: kimi-code-text')).toBe(
      true
    );
  });

  it('sets global agent via /agent --global and persists config', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    factory.register('kimi-code', () => new FakeRunner([]));
    factory.register('kimi-code-text', () => new FakeRunner([]));
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const configPath = join(tempDir, 'config.json');
    await writeFile(configPath, JSON.stringify(makeConfig()), 'utf8');
    const core = new LegionCore({
      config: makeConfig(),
      configPath,
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    await provider.emitMessage(makeMsg('/agent --global kimi-code-text'));

    expect(provider.sent.some((s) => s.text === '已设置全局默认 agent: kimi-code-text')).toBe(true);
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as LegionConfig;
    expect(saved.defaultAgent).toBe('kimi-code-text');
  });

  it('allows omitted agents config and validates against registered runners', async () => {
    const provider = new FakeProvider();
    const factory = new DefaultAgentRunnerFactory();
    factory.register('kimi-code', () => new FakeRunner([{ type: 'text', text: 'ok' }]));
    factory.register('kimi-code-text', () => new FakeRunner([{ type: 'text', text: 'ok' }]));
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    const core = new LegionCore({
      config: {
        discord: { botToken: 'token', allowedGuildId: 'guild' },
        defaultAgent: 'kimi-code',
        stateStore: { path: ':memory:' },
      },
      imProvider: provider,
      runnerFactory: factory,
      stateStore: store,
    });
    await core.start();
    await provider.emitMessage(makeMsg(`/workdir ${tempDir}`));
    await provider.emitMessage(makeMsg('/agent unknown-runner'));

    expect(provider.sent.some((s) => s.text.includes('未知 agent'))).toBe(true);
    expect(provider.sent.some((s) => s.text.includes('kimi-code, kimi-code-text'))).toBe(true);
  });
});
