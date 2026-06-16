import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordProvider } from '../src/discord-provider.js';
import type { AgentEvent } from 'legion';
import type { RenderState } from 'legion';
import type * as Discord from 'discord.js';

interface MockComponent {
  type: number;
  content?: string;
  components?: MockComponent[];
  accent_color?: number;
}

const IS_COMPONENTS_V2 = 1 << 15;

function getComponentContents(call: unknown[]): string[] {
  const options = call[0] as { components?: MockComponent[] };
  const components = options.components ?? [];
  return components.flatMap((component) => {
    if (component.type === 10 && component.content !== undefined) {
      return [component.content];
    }
    return (
      component.components
        ?.filter(
          (c): c is MockComponent & { content: string } => c.type === 10 && c.content !== undefined
        )
        .map((c) => c.content) ?? []
    );
  });
}

function getFlags(call: unknown[]): number {
  const options = call[0] as { flags?: number };
  return options.flags ?? 0;
}

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
  const deleteFn = vi.fn().mockResolvedValue(undefined);
  return {
    isTextBased: () => true,
    isThread: () => false,
    send: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    edit,
    delete: deleteFn,
    messages: {
      fetch: vi.fn().mockResolvedValue({ edit, delete: deleteFn }),
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
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(getFlags(channel.send.mock.calls[0]!)).toBe(IS_COMPONENTS_V2);
    expect(channel.send.mock.calls[0]![0]).toMatchObject({
      components: [{ type: 10, content: 'first' }],
    });
    expect(state.replyMessageRefs).toHaveLength(1);

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'second' }, state);
    expect(channel.edit).toHaveBeenCalledTimes(1);
    expect(getFlags(channel.edit.mock.calls[0]!)).toBe(IS_COMPONENTS_V2);
    expect(getComponentContents(channel.edit.mock.calls[0]!)).toEqual(['second']);
  });

  it('skips text edits within debounce window and flushes on complete', async () => {
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

    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.edit).not.toHaveBeenCalled();
    expect(state.accumulatedOutput?.segments).toHaveLength(1);
    expect(state.accumulatedOutput?.segments[0]).toMatchObject({ type: 'text', content: 'second' });

    await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(getFlags(channel.send.mock.calls[0]!)).toBe(IS_COMPONENTS_V2);
    expect(getComponentContents(channel.send.mock.calls[0]!)).toEqual(['second']);
    expect(state.textEditTimer).toBeUndefined();
  });

  it('flushes pending text when the edit interval fires', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({
        botToken: 'token',
        allowedGuildId: 'guild',
        editDebounceMs: 1000,
      });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'first' }, state);
      expect(channel.send).not.toHaveBeenCalled();
      expect(state.textEditTimer).toBeDefined();

      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(getComponentContents(channel.send.mock.calls[0]!)).toEqual(['first']);

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'second' }, state);
      expect(channel.edit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.edit).toHaveBeenCalledTimes(1);
      expect(getComponentContents(channel.edit.mock.calls[0]!)).toEqual(['second']);

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);
      expect(state.textEditTimer).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('batches rapid text events into a single Discord send/edit', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({
        botToken: 'token',
        allowedGuildId: 'guild',
        editDebounceMs: 1000,
      });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      // Simulate a fast token stream: 5 text events in a row.
      for (let i = 1; i <= 5; i++) {
        await provider.renderEvent(
          { channelId: 'ch-1' },
          { type: 'text', text: 'token'.repeat(i) },
          state
        );
      }

      expect(channel.send).not.toHaveBeenCalled();
      expect(channel.edit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(getComponentContents(channel.send.mock.calls[0]!)).toEqual(['token'.repeat(5)]);
      expect(channel.edit).not.toHaveBeenCalled();

      // After the first interval, further text should be edited, not sent as a new message.
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'text', text: 'token'.repeat(6) },
        state
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(channel.edit).toHaveBeenCalledTimes(1);
      expect(getComponentContents(channel.edit.mock.calls[0]!)).toEqual(['token'.repeat(6)]);

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);
      expect(state.textEditTimer).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves spaces when accumulating text deltas', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({
        botToken: 'token',
        allowedGuildId: 'guild',
        editDebounceMs: 1000,
      });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'text', text: 'Hello', delta: 'Hello' },
        state
      );
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'text', text: 'Hello world', delta: ' world' },
        state
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(getComponentContents(channel.send.mock.calls[0]!)).toEqual(['Hello world']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders thinking before text in the unified output', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({
        botToken: 'token',
        allowedGuildId: 'guild',
        editDebounceMs: 1000,
      });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'thinking', text: 'thinking...', delta: 'thinking...' },
        state
      );
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'text', text: 'answer', delta: 'answer' },
        state
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);
      const contents = getComponentContents(channel.send.mock.calls[0]!);
      expect(contents).toEqual(['💭 thinking...', 'answer']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders tool_call and tool_result inside the unified output', async () => {
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

    const toolCall: AgentEvent = {
      type: 'tool_call',
      toolId: 't1',
      toolName: 'read_file',
      input: { path: '/tmp/a' },
    };
    await provider.renderEvent({ channelId: 'ch-1' }, toolCall, state);
    expect(channel.send).toHaveBeenCalledTimes(1);
    let contents = getComponentContents(channel.send.mock.calls[0]!);
    expect(contents[0]).toContain('🔧 read_file');

    const toolResult: AgentEvent = { type: 'tool_result', toolId: 't1', output: 'content' };
    await provider.renderEvent({ channelId: 'ch-1' }, toolResult, state);
    expect(channel.edit).toHaveBeenCalledTimes(1);
    contents = getComponentContents(channel.edit.mock.calls[0]!);
    expect(contents[0]).toContain('🔧 read_file');
    expect(contents[1]).toContain('✅ read_file');
    expect(contents[1]).toContain('content');
  });

  it('renders tool_call_delta as a streaming partial tool call', async () => {
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

    await provider.renderEvent(
      { channelId: 'ch-1' },
      {
        type: 'tool_call_delta',
        toolId: 't1',
        toolName: 'bash',
        partialInput: '{"com',
        delta: '{"com',
      },
      state
    );
    expect(channel.send).toHaveBeenCalledTimes(1);
    let contents = getComponentContents(channel.send.mock.calls[0]!);
    expect(contents[0]).toContain('🔧 bash');
    expect(contents[0]).toContain('{"com');

    await provider.renderEvent(
      { channelId: 'ch-1' },
      {
        type: 'tool_call_delta',
        toolId: 't1',
        toolName: 'bash',
        partialInput: '{"command":"ls"',
        delta: 'mand":"ls"}',
      },
      state
    );
    expect(channel.edit).toHaveBeenCalledTimes(1);
    contents = getComponentContents(channel.edit.mock.calls[0]!);
    expect(contents[0]).toContain('{"command":"ls"');

    await provider.renderEvent(
      { channelId: 'ch-1' },
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: 'ls' } },
      state
    );
    expect(channel.edit).toHaveBeenCalledTimes(2);
    contents = getComponentContents(channel.edit.mock.calls[1]!);
    expect(contents[0]).toContain('🔧 bash');
    expect(contents[0]).toContain('"command": "ls"');
  });

  it('splits a very long tool_call input while keeping each chunk in a code block', async () => {
    vi.useFakeTimers();
    try {
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

      const longCommand = 'a'.repeat(6000);
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: longCommand } },
        state
      );

      expect(channel.send).toHaveBeenCalledTimes(3);

      const allTextDisplays: MockComponent[] = [];
      for (const call of channel.send.mock.calls) {
        const components = (call![0] as { components: MockComponent[] }).components;
        expect(components[0]).toMatchObject({ type: 17, accent_color: 0xf39c12 });
        allTextDisplays.push(...(components[0]!.components ?? []));
      }

      expect(allTextDisplays[0]!.content).toBe('🔧 bash');
      for (let i = 1; i < allTextDisplays.length; i++) {
        const chunk = allTextDisplays[i]!.content;
        expect(chunk).toMatch(/^```json\n/);
        expect(chunk).toMatch(/\n```$/);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders text and tool round in the same unified message', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'first' }, state);
      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);

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

      await vi.advanceTimersByTimeAsync(1000);

      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(channel.edit).toHaveBeenCalledTimes(1);
      const contents = getComponentContents(channel.edit.mock.calls[0]!);
      expect(contents).toHaveLength(4);
      expect(contents[0]).toContain('first');
      expect(contents[1]).toContain('🔧 bash');
      expect(contents[2]).toContain('✅ bash');
      expect(contents[2]).toContain('a.txt');
      expect(contents[3]).toContain('summary');
    } finally {
      vi.useRealTimers();
    }
  });

  it('groups segments into type-specific colored containers', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: 'answer' }, state);
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'thinking', text: 'thinking...', delta: 'thinking...' },
        state
      );
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
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'error', message: 'oops', fatal: true },
        state
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(channel.send).toHaveBeenCalledTimes(1);
      const options = channel.send.mock.calls[0]![0] as { components: MockComponent[] };
      const containers = options.components;
      expect(containers).toHaveLength(5);
      expect(containers[0]).toMatchObject({ type: 10, content: 'answer' });
      expect(containers[1]).toMatchObject({ type: 17, accent_color: 0x3498db });
      expect(containers[2]).toMatchObject({ type: 17, accent_color: 0xf39c12 });
      expect(containers[3]).toMatchObject({ type: 17, accent_color: 0x2ecc71 });
      expect(containers[4]).toMatchObject({ type: 17, accent_color: 0xff0000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the tail of long unified output so the final answer remains visible', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
      await provider.start();
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      const longPrefix = 'a'.repeat(1500);
      const finalAnswer = 'final answer text';
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: longPrefix }, state);
      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(1);

      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: 'ls' } },
        state
      );
      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'tool_result', toolId: 't1', output: 'b'.repeat(1000) },
        state
      );
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: finalAnswer }, state);
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);

      expect(channel.edit).toHaveBeenCalledTimes(1);
      const contents = getComponentContents(channel.edit.mock.calls[0]!);
      const allText = contents.join('');
      expect(allText).toContain(finalAnswer);
      expect(allText.length).toBeLessThanOrEqual(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('splits long output across multiple Discord messages', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      const longText = 'a'.repeat(7000);
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'text', text: longText }, state);
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);

      expect(channel.send).toHaveBeenCalledTimes(2);
      expect(channel.edit).not.toHaveBeenCalled();
      expect(state.replyMessageRefs).toHaveLength(2);
      const firstContents = getComponentContents(channel.send.mock.calls[0]!);
      const secondContents = getComponentContents(channel.send.mock.calls[1]!);
      const allText = firstContents.join('') + secondContents.join('');
      expect(allText).toContain(longText);
      expect(firstContents[0]?.length).toBeLessThanOrEqual(4000);
      expect(secondContents[0]?.length).toBeLessThanOrEqual(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('truncates tool_result output to the tail', async () => {
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

    const tail = 'tail-content';
    const longOutput = 'a'.repeat(2000) + tail;
    await provider.renderEvent(
      { channelId: 'ch-1' },
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: 'ls' } },
      state
    );
    await provider.renderEvent(
      { channelId: 'ch-1' },
      { type: 'tool_result', toolId: 't1', output: longOutput },
      state
    );

    const contents = getComponentContents(channel.edit.mock.calls[0]!);
    const toolResultText = contents[1];
    expect(toolResultText).toContain(tail);
    expect(toolResultText).toContain('...');
    expect(toolResultText.length).toBeLessThanOrEqual(1000);
  });

  it('deletes extra old messages when pages shrink', async () => {
    vi.useFakeTimers();
    try {
      const provider = new DiscordProvider({ botToken: 'token', allowedGuildId: 'guild' });
      const channel = createMockChannel();
      lastClient().channels.fetch.mockResolvedValue(channel);

      const state: RenderState = {
        toolMessageRefs: new Map(),
      };

      await provider.renderEvent(
        { channelId: 'ch-1' },
        { type: 'text', text: 'a'.repeat(7000) },
        state
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(channel.send).toHaveBeenCalledTimes(2);

      // Replace the long text with a short one so only one page remains.
      state.accumulatedOutput = { segments: [{ type: 'text', content: 'short' }] };
      await provider.renderEvent({ channelId: 'ch-1' }, { type: 'complete', exitCode: 0 }, state);

      expect(channel.edit).toHaveBeenCalledTimes(1);
      expect(channel.messages.fetch).toHaveBeenCalledTimes(2); // 1 edit fetch + 1 delete fetch
      expect(channel.delete).toHaveBeenCalledTimes(1);
      expect(channel.edit.mock.calls[0]![0]).toMatchObject({
        components: [expect.objectContaining({ type: 10, content: 'short' })],
      });
    } finally {
      vi.useRealTimers();
    }
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
