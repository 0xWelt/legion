import { spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KimiCodeRunner } from '../src/kimi-code-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface MockProcess extends EventEmitter {
  stdout: Readable;
  killed: boolean;
  exitCode: number | null;
  kill: (signal: string) => boolean;
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
      // Emit exit after the listener has been registered.
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

describe('KimiCodeRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns kimi with prompt and output format', async () => {
    mockSpawn(['{"role":"assistant","content":"hi"}']);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(spawn).toHaveBeenCalledWith(
      'kimi',
      ['-p', 'hello', '--output-format', 'stream-json'],
      expect.objectContaining({ cwd: '/tmp' })
    );
    expect(events).toContainEqual({ type: 'text', text: 'hi' });
  });

  it('passes session id when available', async () => {
    mockSpawn([]);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    for await (const _ of runner.run(
      { sessionId: 's1', workdir: '/tmp', agentSessionId: 'kimi-session-1' },
      'hello'
    )) {
      // no-op
    }
    expect(spawn).toHaveBeenCalledWith(
      'kimi',
      ['-p', 'hello', '--output-format', 'stream-json', '--session', 'kimi-session-1'],
      expect.anything()
    );
  });

  it('emits session_init from legacy meta event', async () => {
    mockSpawn(['{"role":"meta","session":{"resume_hint":{"session_id":"abc"}}}']);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'session_init', agentSessionId: 'abc' });
  });

  it('emits session_init from real kimi meta event', async () => {
    mockSpawn([
      '{"role":"meta","type":"session.resume_hint","session_id":"real-session-1","command":"kimi -r real-session-1","content":"To resume this session: kimi -r real-session-1"}',
    ]);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'session_init', agentSessionId: 'real-session-1' });
  });

  it('emits tool_call and tool_result events', async () => {
    mockSpawn([
      '{"role":"tool","tool_call_id":"t1","name":"read_file","input":{"path":"/tmp/a"}}',
      '{"role":"tool","tool_call_id":"t1","content":"file content"}',
    ]);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 't1',
      toolName: 'read_file',
      input: { path: '/tmp/a' },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 't1',
      output: 'file content',
    });
  });

  it('emits tool_call from assistant tool_calls field', async () => {
    mockSpawn([
      '{"role":"assistant","tool_calls":[{"type":"function","id":"t1","function":{"name":"WebSearch","arguments":"{\\"query\\":\\"上海天气\\"}"}}]}',
      '{"role":"tool","tool_call_id":"t1","content":"search result"}',
      '{"role":"assistant","content":"今天上海天气晴朗"}',
    ]);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_call',
      toolId: 't1',
      toolName: 'WebSearch',
      input: { query: '上海天气' },
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 't1',
      output: 'search result',
    });
    expect(events).toContainEqual({ type: 'text', text: '今天上海天气晴朗' });
  });

  it('emits complete event with exit code', async () => {
    mockSpawn(['{"role":"assistant","content":"done"}'], 0);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });

  it('kills running process on interrupt', async () => {
    const proc = mockSpawn([]);
    const runner = new KimiCodeRunner({ binary: 'kimi' });
    const runPromise = (async () => {
      for await (const _ of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hello')) {
        // no-op
      }
    })();
    await runner.interrupt();
    await runPromise;
    expect(proc.kill).toHaveBeenCalledWith('SIGINT');
  });
});
