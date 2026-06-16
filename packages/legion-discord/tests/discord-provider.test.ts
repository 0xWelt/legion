import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordProvider } from '../src/discord-provider.js';
import type { AgentEvent } from 'legion';
import type { RenderState } from 'legion';
import type * as Discord from 'discord.js';

const mockInstances: Array<{
  on: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  channels: { fetch: ReturnType<typeof vi.fn> };
}> = [];

vi.mock('discord.js', async () => {
  const actual = await vi.importActual<typeof Discord>('discord.js');
  return {
    ...actual,
    Client: function () {
      const instance = {
        on: vi.fn(),
        login: vi.fn().mockResolvedValue(undefined),
        channels: {
          fetch: vi.fn(),
        },
      };
      mockInstances.push(instance);
      return instance;
    },
  };
});

function createMockChannel() {
  const edit = vi.fn().mockResolvedValue(undefined);
  return {
    isTextBased: () => true,
    isThread: () => false,
    send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    edit,
    messages: {
      fetch: vi.fn().mockResolvedValue({ edit }),
    },
  };
}

function lastClient() {
  return mockInstances[mockInstances.length - 1];
}

describe('DiscordProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstances.length = 0;
  });

  it('logs in on start', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    await provider.start();
    expect(lastClient().login).toHaveBeenCalledWith('token');
  });

  it('sends text messages', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const ref = await provider.sendText({ channelId: 'ch-1' }, 'hello');
    expect(channel.send).toHaveBeenCalledWith({ content: 'hello' });
    expect(ref).toEqual({ provider: 'discord', channelId: 'ch-1', messageId: 'msg-1' });
  });

  it('truncates long text', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const longText = 'a'.repeat(3000);
    await provider.sendText({ channelId: 'ch-1' }, longText);
    expect(channel.send).toHaveBeenCalledWith({ content: 'a'.repeat(2000) });
  });

  it('renders text events by creating then editing a message', async () => {
    const provider = new DiscordProvider({
      botToken: 'token',
      allowedGuildId: 'guild',
      editDebounceMs: 0,
    });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const state: RenderState = {
      toolMessageRefs: new Map(),
    };

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'first' }, state);
    expect(channel.send).toHaveBeenCalledWith({ content: 'first' });
    expect(state.replyMessageRef).toBeDefined();

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'second' }, state);
    expect(channel.edit).toHaveBeenCalledWith('second');
  });

  it('skips text edits within debounce window', async () => {
    const provider = new DiscordProvider({
      botToken: 'token',
      allowedGuildId: 'guild',
      editDebounceMs: 60_000,
    });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const state: RenderState = {
      toolMessageRefs: new Map(),
    };

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'first' }, state);
    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'second' }, state);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.edit).not.toHaveBeenCalled();
    expect(state.pendingText).toBe('second');
  });

  it('renders tool_call and tool_result as separate messages', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const state: RenderState = {
      toolMessageRefs: new Map(),
    };

    const toolCall: AgentEvent = {
      type: 'tool_call',
      toolId: 't1',
      toolName: 'read_file',
      input: { path: '/tmp/a' },
    };
    await provider.renderEvent({ channelId: 'ch-1' }, toolCall, state);
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('🔧 read_file') })
    );
    expect(state.hasToolCall).toBe(true);

    const toolResult: AgentEvent = { type: 'tool_result', toolId: 't1', output: 'content' };
    await provider.renderEvent({ channelId: 'ch-1' }, toolResult, state);
    expect(channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: expect.stringContaining('content') })
    );
  });

  it('starts a new text message after a tool round', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    const channel = createMockChannel();
    lastClient().channels.fetch.mockResolvedValue(channel);

    const state: RenderState = {
      toolMessageRefs: new Map(),
    };

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'first' }, state);
    await provider.renderEvent(
      { channelId: 'ch-1' },
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: 'ls' } },
      state
    );
    await provider.renderEvent(
      { channelId: 'ch-1' },
      { type: 'tool_result', toolId: 't1', output: 'a.txt' },
      state
    );
    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'summary' }, state);

    expect(channel.send).toHaveBeenCalledTimes(4);
    expect(channel.edit).not.toHaveBeenCalled();
  });

  it('skips system messages', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    await provider.start();
    const handler = vi.fn();
    provider.onMessage(handler);

    const calls = lastClient().on.mock.calls as Array<[string, (msg: unknown) => void]>;
    const messageCreate = calls.find(([event]) => event === 'messageCreate')?.[1];
    expect(messageCreate).toBeDefined();

    messageCreate!({
      author: { bot: false, id: 'user-1', username: 'tester' },
      system: true,
      guildId: 'guild',
      channelId: 'ch-1',
      channel: { isThread: () => false },
      id: 'sys-1',
      content: 'started a thread',
      createdAt: new Date(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('maps thread message channelId to parent channel', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    await provider.start();
    const handler = vi.fn();
    provider.onMessage(handler);

    const calls = lastClient().on.mock.calls as Array<[string, (msg: unknown) => void]>;
    const messageCreate = calls.find(([event]) => event === 'messageCreate')?.[1];
    expect(messageCreate).toBeDefined();

    messageCreate!({
      author: { bot: false, id: 'user-1', username: 'tester' },
      system: false,
      guildId: 'guild',
      channelId: 'thread-1',
      channel: {
        isThread: () => true,
        parentId: 'ch-1',
      },
      id: 'msg-1',
      content: 'hello',
      createdAt: new Date(),
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'ch-1', threadId: 'thread-1' })
    );
  });

  it('sends workspace guide on new text channel create', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    await provider.start();

    const calls = lastClient().on.mock.calls as Array<[string, (ch: unknown) => void]>;
    const channelCreate = calls.find(([event]) => event === 'channelCreate')?.[1];
    expect(channelCreate).toBeDefined();

    const channel = createMockChannel();
    (channel as unknown as { guildId: string }).guildId = 'guild';
    channelCreate!(channel);

    expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('/workdir'));
  });

  it('falls back to non-reply send when reply target is a system message', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    const channel = createMockChannel();
    const systemError = new Error('REPLIES_CANNOT_REPLY_TO_SYSTEM_MESSAGE');
    channel.send.mockRejectedValueOnce(systemError).mockResolvedValueOnce({ id: 'msg-2' });
    lastClient().channels.fetch.mockResolvedValue(channel);

    const ref = await provider.sendText({ channelId: 'ch-1', replyToMessageId: 'sys-1' }, 'hello');
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send).toHaveBeenNthCalledWith(1, {
      content: 'hello',
      reply: { messageReference: 'sys-1' },
    });
    expect(channel.send).toHaveBeenNthCalledWith(2, { content: 'hello' });
    expect(ref.messageId).toBe('msg-2');
  });

  it('handles slash command interaction by editing the deferred reply', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    provider.registerCommands([
      {
        name: 'workdir',
        description: '绑定或查看当前 workdir 的工作目录',
        options: [{ name: 'path', description: '目录路径', required: false }],
      },
    ]);
    await provider.start();
    const handler = vi.fn();
    provider.onMessage(handler);

    const calls = lastClient().on.mock.calls as Array<[string, (msg: unknown) => void]>;
    const interactionCreate = calls.find(([event]) => event === 'interactionCreate')?.[1];
    expect(interactionCreate).toBeDefined();

    const editReply = vi.fn().mockResolvedValue({ id: 'reply-1' });
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'workdir',
      guildId: 'guild',
      channelId: 'ch-1',
      channel: { isThread: () => false },
      user: { id: 'user-1', username: 'tester' },
      id: 'interaction-1',
      options: { getString: vi.fn().mockReturnValue('/tmp/repo') },
      deferReply,
      editReply,
    };

    await interactionCreate!(interaction);

    expect(deferReply).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'interaction-1',
        content: '/workdir /tmp/repo',
        channelId: 'ch-1',
      })
    );

    const ref = await provider.sendText(
      { channelId: 'ch-1', replyToMessageId: 'interaction-1' },
      'bound'
    );
    expect(editReply).toHaveBeenCalledWith({ content: 'bound' });
    expect(ref.messageId).toBe('reply-1');
  });

  it('keeps separate pending interactions for concurrent slash commands', async () => {
    const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
    provider.registerCommands([
      {
        name: 'workdir',
        description: '绑定或查看当前 workdir 的工作目录',
        options: [{ name: 'path', description: '目录路径', required: false }],
      },
      {
        name: 'status',
        description: '查看状态',
      },
    ]);
    await provider.start();

    const handler = vi.fn();
    provider.onMessage(handler);

    const calls = lastClient().on.mock.calls as Array<[string, (msg: unknown) => void]>;
    const interactionCreate = calls.find(([event]) => event === 'interactionCreate')?.[1];
    expect(interactionCreate).toBeDefined();

    const editReply1 = vi.fn().mockResolvedValue({ id: 'reply-1' });
    const interaction1 = {
      isChatInputCommand: () => true,
      commandName: 'workdir',
      guildId: 'guild',
      channelId: 'ch-1',
      channel: { isThread: () => false },
      user: { id: 'user-1', username: 'tester' },
      id: 'interaction-1',
      options: { getString: vi.fn().mockReturnValue('/tmp/repo') },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: editReply1,
    };

    const editReply2 = vi.fn().mockResolvedValue({ id: 'reply-2' });
    const interaction2 = {
      isChatInputCommand: () => true,
      commandName: 'status',
      guildId: 'guild',
      channelId: 'ch-1',
      channel: { isThread: () => false },
      user: { id: 'user-1', username: 'tester' },
      id: 'interaction-2',
      options: { getString: vi.fn() },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: editReply2,
    };

    // Start both interactions but do not await their handlers yet.
    const pending1 = interactionCreate!(interaction1);
    const pending2 = interactionCreate!(interaction2);

    // Both should be deferred.
    await Promise.all([pending1, pending2]);

    // Replies sent in reverse order must each edit their own interaction.
    const ref2 = await provider.sendText(
      { channelId: 'ch-1', replyToMessageId: 'interaction-2' },
      'status ok'
    );
    expect(editReply2).toHaveBeenCalledWith({ content: 'status ok' });
    expect(ref2.messageId).toBe('reply-2');

    const ref1 = await provider.sendText(
      { channelId: 'ch-1', replyToMessageId: 'interaction-1' },
      'bound'
    );
    expect(editReply1).toHaveBeenCalledWith({ content: 'bound' });
    expect(ref1.messageId).toBe('reply-1');
  });
});
