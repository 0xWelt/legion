import { spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeRunner } from '../src/claude-code-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface MockProcess extends EventEmitter {
  stdout: Readable;
  killed: boolean;
  exitCode: number | null;
  kill: (signal: string) => boolean;
}

function resultEvent(
  subtype: 'success' | 'error',
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    type: 'result',
    subtype,
    total_cost_usd: 0,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {
      'claude-model': {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      },
    },
    ...overrides,
  });
}

function mockSpawn(lines: string[], exitCode = 0): MockProcess {
  const stdout = Readable.from(lines.join('\n'));
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = stdout;
  proc.killed = false;
  proc.exitCode = null;
  proc.kill = vi.fn().mockImplementation(() => {
    proc.killed = true;
    return true;
  });

  const originalOn = proc.on.bind(proc);
  proc.on = vi.fn((event: string | symbol, listener: (...args: unknown[]) => void) => {
    if (event === 'exit') {
      process.nextTick(() => {
        proc.exitCode = exitCode;
        proc.emit('exit', exitCode);
      });
    }
    return originalOn(event, listener);
  }) as unknown as MockProcess['on'];

  vi.mocked(spawn).mockImplementation(() => {
    return proc as unknown as ReturnType<typeof spawn>;
  });

  return proc;
}

describe('ClaudeCodeRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns claude with prompt and stream-json output', async () => {
    mockSpawn([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-1' }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      }),
      resultEvent('success'),
    ]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        'hello',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'bypassPermissions',
      ],
      expect.objectContaining({ cwd: '/tmp' })
    );
    expect(events).toContainEqual({ type: 'session_init', agentSessionId: 'session-1' });
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });

  it('uses custom permission mode when configured', async () => {
    mockSpawn([resultEvent('success')]);
    const runner = new ClaudeCodeRunner({ binary: 'claude', permissionMode: 'plan' });
    for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      // no-op
    }
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['-p', 'hello', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'plan'],
      expect.anything()
    );
  });

  it('passes resume flag when session id is available', async () => {
    mockSpawn([resultEvent('success')]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    for await (const _ of runner.run(
      { sessionId: 's1', workdir: '/tmp', agentSessionId: 'claude-session-1' },
      'hello'
    )) {
      // no-op
    }
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        'hello',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'bypassPermissions',
        '--resume',
        'claude-session-1',
      ],
      expect.anything()
    );
  });

  it('emits thinking events', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'I should greet the user' }],
        },
      }),
      resultEvent('success'),
    ]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'thinking', text: 'I should greet the user' });
  });

  it('emits tool_call and tool_result events', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file content' }],
        },
      }),
      resultEvent('success'),
    ]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 'tool-1',
      toolName: 'Read',
      input: { file_path: '/tmp/a' },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 'tool-1',
      output: 'file content',
    });
  });

  it('emits usage event from modelUsage', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.05,
        modelUsage: {
          'kimi-for-coding': {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 10,
            costUSD: 0.05,
          },
        },
      }),
    ]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 200,
      cacheCreationTokens: 10,
      costUsd: 0.05,
    });
  });

  it('emits error event for error result', async () => {
    mockSpawn([
      resultEvent('error', {
        is_error: true,
        api_error_status: 'rate_limit',
        result: 'Rate limit exceeded',
      }),
    ]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'error',
      message: 'rate_limit',
      fatal: true,
    });
  });

  it('ignores malformed json lines', async () => {
    mockSpawn(['not-json', resultEvent('success')]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });

  it('kills running process on interrupt', async () => {
    const proc = mockSpawn([]);
    const runner = new ClaudeCodeRunner({ binary: 'claude' });
    const runPromise = (async () => {
      for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        // no-op
      }
    })();
    await runner.interrupt();
    await runPromise;
    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
  });

  describe('streaming event sequences', () => {
    it('emits multiple assistant events in order: thinking then text', async () => {
      mockSpawn([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'thinking-1' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'text-1' }],
          },
        }),
        resultEvent('success'),
      ]);
      const runner = new ClaudeCodeRunner({ binary: 'claude' });
      const events: unknown[] = [];
      for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'thinking', text: 'thinking-1' },
        { type: 'text', text: 'text-1' },
        {
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        },
        { type: 'complete', exitCode: 0 },
      ]);
    });

    it('handles a full tool-use round trip with follow-up text', async () => {
      mockSpawn([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'I need to run a command' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo hi' } },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'hi' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'The command output was hi' }],
          },
        }),
        resultEvent('success'),
      ]);
      const runner = new ClaudeCodeRunner({ binary: 'claude' });
      const events: unknown[] = [];
      for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'thinking', text: 'I need to run a command' },
        { type: 'tool_call', toolId: 'tool-1', toolName: 'Bash', input: { command: 'echo hi' } },
        { type: 'tool_result', toolId: 'tool-1', output: 'hi' },
        { type: 'text', text: 'The command output was hi' },
        {
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        },
        { type: 'complete', exitCode: 0 },
      ]);
    });

    it('handles mixed content blocks within a single assistant message', async () => {
      mockSpawn([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'thinking-a' },
              { type: 'text', text: 'text-a' },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/tmp/b' } },
            ],
          },
        }),
        resultEvent('success'),
      ]);
      const runner = new ClaudeCodeRunner({ binary: 'claude' });
      const events: unknown[] = [];
      for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'thinking', text: 'thinking-a' },
        { type: 'text', text: 'text-a' },
        { type: 'tool_call', toolId: 'tool-2', toolName: 'Read', input: { file_path: '/tmp/b' } },
        {
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        },
        { type: 'complete', exitCode: 0 },
      ]);
    });

    it('emits multiple tool_result blocks from a single user message', async () => {
      mockSpawn([
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-a', content: 'result-a' },
              { type: 'tool_result', tool_use_id: 'tool-b', content: 'result-b' },
            ],
          },
        }),
        resultEvent('success'),
      ]);
      const runner = new ClaudeCodeRunner({ binary: 'claude' });
      const events: unknown[] = [];
      for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'tool_result', toolId: 'tool-a', output: 'result-a' },
        { type: 'tool_result', toolId: 'tool-b', output: 'result-b' },
        {
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        },
        { type: 'complete', exitCode: 0 },
      ]);
    });

    it('preserves event order across interleaved thinking, tool_use, tool_result and text', async () => {
      mockSpawn([
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'first thought' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'foo' } }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't1', content: 'found bar' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'second thought' }],
          },
        }),
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'final answer' }],
          },
        }),
        resultEvent('success'),
      ]);
      const runner = new ClaudeCodeRunner({ binary: 'claude' });
      const events: unknown[] = [];
      for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        events.push(event);
      }
      expect(events).toEqual([
        { type: 'thinking', text: 'first thought' },
        { type: 'tool_call', toolId: 't1', toolName: 'Grep', input: { pattern: 'foo' } },
        { type: 'tool_result', toolId: 't1', output: 'found bar' },
        { type: 'thinking', text: 'second thought' },
        { type: 'text', text: 'final answer' },
        {
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0,
        },
        { type: 'complete', exitCode: 0 },
      ]);
    });
  });
});
