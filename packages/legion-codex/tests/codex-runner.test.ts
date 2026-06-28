import { spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexRunner } from '../src/codex-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface MockProcess extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  exitCode: number | null;
  kill: (signal: string) => boolean;
}

function mockSpawn(lines: string[], exitCode = 0): MockProcess {
  const stdout = Readable.from(lines.join('\n'));
  const stderr = Readable.from([]);
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = stdout;
  proc.stderr = stderr;
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

describe('CodexRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns codex exec with json output and sandbox bypass', async () => {
    mockSpawn([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'hi' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 10,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'],
      expect.objectContaining({ cwd: '/tmp' })
    );
    expect(events).toContainEqual({ type: 'session_init', agentSessionId: 'thread-1' });
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });

  it('passes resume subcommand when session id is available', async () => {
    mockSpawn([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    for await (const _ of runner.run(
      { sessionId: 's1', workdir: '/tmp', agentSessionId: 'codex-thread-1' },
      'hello'
    )) {
      // no-op
    }
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      [
        'exec',
        '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        'resume',
        'codex-thread-1',
        '-',
      ],
      expect.anything()
    );
  });

  it('uses custom model when configured', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex', model: 'o3' });
    for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      // no-op
    }
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-m', 'o3', '-'],
      expect.anything()
    );
  });

  it('emits tool_call and tool_result for command_execution', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/usr/bin/zsh -lc 'ls'",
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/usr/bin/zsh -lc 'ls'",
          aggregated_output: 'hi.txt\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_1', type: 'agent_message', text: 'Done' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'tool_call',
        toolId: 'item_0',
        toolName: 'command_execution',
        input: { command: "/usr/bin/zsh -lc 'ls'" },
      },
      {
        type: 'tool_result',
        toolId: 'item_0',
        output: 'hi.txt\n',
      },
      { type: 'text', text: 'Done' },
      {
        type: 'usage',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: undefined,
      },
      { type: 'complete', exitCode: 0 },
    ]);
  });

  it('emits tool_call on completed event even when start was missing', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/usr/bin/zsh -lc 'ls'",
          aggregated_output: 'hi.txt\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: 'tool_call',
        toolId: 'item_0',
        toolName: 'command_execution',
        input: { command: "/usr/bin/zsh -lc 'ls'" },
      },
      {
        type: 'tool_result',
        toolId: 'item_0',
        output: 'hi.txt\n',
      },
      {
        type: 'usage',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: undefined,
      },
      { type: 'complete', exitCode: 0 },
    ]);
  });

  it('emits usage event from turn.completed', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 25,
          reasoning_output_tokens: 10,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      costUsd: undefined,
    });
  });

  it('ignores malformed json lines', async () => {
    mockSpawn([
      'not-json',
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });

  it('kills running process on interrupt', async () => {
    const proc = mockSpawn([]);
    const runner = new CodexRunner({ binary: 'codex' });
    const runPromise = (async () => {
      for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        // no-op
      }
    })();
    await runner.interrupt();
    await runPromise;
    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('writes prompt to stdin and closes it', async () => {
    const proc = mockSpawn([
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello world')) {
      // no-op
    }
    expect(proc.stdin.write).toHaveBeenCalledWith('hello world');
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('filters benign stdin notice from stderr', async () => {
    const stderr = Readable.from([Buffer.from('Reading additional input from stdin...\n')]);
    const stdout = Readable.from([
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const proc = new EventEmitter() as MockProcess;
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.stdout = stdout;
    proc.stderr = stderr;
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
          proc.exitCode = 0;
          proc.emit('exit', 0);
        });
      }
      return originalOn(event, listener);
    }) as unknown as MockProcess['on'];
    vi.mocked(spawn).mockImplementation(() => proc as unknown as ReturnType<typeof spawn>);

    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    const errors = events.filter((e) => (e as { type: string }).type === 'error');
    expect(errors).toHaveLength(0);
  });

  it('emits thinking events for reasoning items', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'reasoning', text: 'I should plan first' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'thinking', text: 'I should plan first' });
  });

  it('emits fatal error for turn.failed', async () => {
    mockSpawn([
      JSON.stringify({ type: 'turn.failed', error: { message: 'model error' } }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'error', message: 'model error', fatal: true });
  });

  it('emits fatal error for top-level error event', async () => {
    mockSpawn([
      JSON.stringify({ type: 'error', message: 'stream broken' }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'error', message: 'stream broken', fatal: true });
  });

  it('emits non-fatal error for item-level error', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'error', message: 'dropped events' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'error', message: 'dropped events', fatal: false });
  });

  it('emits tool_call and tool_result for file_change items', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'file_change',
          changes: [{ path: 'src/foo.ts', kind: 'add' }],
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 'item_0',
      toolName: 'file_change',
      input: { changes: [{ path: 'src/foo.ts', kind: 'add' }] },
    });
    expect(events).toContainEqual({ type: 'tool_result', toolId: 'item_0', output: 'completed' });
  });

  it('emits tool_call and tool_result for mcp_tool_call items', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'fetch',
          tool: 'getUrl',
          arguments: { url: 'https://example.com' },
          status: 'in_progress',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'mcp_tool_call',
          server: 'fetch',
          tool: 'getUrl',
          arguments: { url: 'https://example.com' },
          result: { content: [{ type: 'text', text: 'ok' }], structured_content: { ok: true } },
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 'item_0',
      toolName: 'mcp:fetch:getUrl',
      input: { url: 'https://example.com' },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 'item_0',
      output: JSON.stringify({ ok: true }),
    });
  });

  it('emits tool_call for web_search items', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'web_search', query: 'latest TypeScript' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 'item_0',
      toolName: 'web_search',
      input: { query: 'latest TypeScript' },
    });
  });

  it('ignores item.updated events', async () => {
    mockSpawn([
      JSON.stringify({
        type: 'item.updated',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/usr/bin/zsh -lc 'ls'",
          aggregated_output: 'partial',
          exit_code: null,
          status: 'in_progress',
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'command_execution',
          command: "/usr/bin/zsh -lc 'ls'",
          aggregated_output: 'hi.txt\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      }),
    ]);
    const runner = new CodexRunner({ binary: 'codex' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    const toolResults = events.filter((e) => (e as { type: string }).type === 'tool_result');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toEqual({ type: 'tool_result', toolId: 'item_0', output: 'hi.txt\n' });
  });
});
