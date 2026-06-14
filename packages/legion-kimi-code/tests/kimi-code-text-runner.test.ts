import { spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KimiCodeTextRunner } from '../src/kimi-code-text-runner.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

interface MockProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  killed: boolean;
  exitCode: number | null;
  kill: (signal: string) => boolean;
}

function mockSpawn(options: { stdout?: string; stderr?: string; exitCode?: number }): MockProcess {
  const stdout = Readable.from(options.stdout ?? '');
  const stderr = Readable.from(options.stderr ?? '');
  const proc = new EventEmitter() as MockProcess;
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
        proc.exitCode = options.exitCode ?? 0;
        proc.emit('exit', options.exitCode ?? 0);
      });
    }
    return originalOn(event, listener);
  }) as unknown as MockProcess['on'];

  vi.mocked(spawn).mockImplementation(() => {
    return proc as unknown as ReturnType<typeof spawn>;
  });

  return proc;
}

describe('KimiCodeTextRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns kimi with text output format', async () => {
    mockSpawn({ stdout: 'hello' });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(spawn).toHaveBeenCalledWith(
      'kimi',
      ['-p', 'hi', '--output-format', 'text'],
      expect.objectContaining({ cwd: '/tmp' })
    );
    expect(events).toContainEqual({ type: 'text', text: 'hello' });
  });

  it('strips leading bullet from stdout text', async () => {
    mockSpawn({ stdout: '• hello world' });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'text', text: 'hello world' });
  });

  it('emits thinking events from stderr bullets', async () => {
    mockSpawn({ stdout: 'done', stderr: '• I should think about this' });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'thinking', text: 'I should think about this' });
  });

  it('collects indented continuation lines after a bullet into one thinking event', async () => {
    mockSpawn({
      stdout: 'done',
      stderr: '• first line\n  continuation 1\n  continuation 2\nraw output',
    });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'thinking',
      text: 'first line\ncontinuation 1\ncontinuation 2',
    });
    expect(events).toContainEqual({ type: 'tool_result', toolId: 'unknown', output: 'raw output' });
  });

  it('emits tool_result from raw stderr output', async () => {
    mockSpawn({ stdout: 'result', stderr: 'line1\nline2' });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 'unknown',
      output: 'line1\nline2',
    });
  });

  it('treats non-bullet reasoning lines after tool output as thinking', async () => {
    mockSpawn({ stdout: 'result', stderr: 'raw output\nI have the result.' });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({
      type: 'tool_result',
      toolId: 'unknown',
      output: 'raw output',
    });
    expect(events).toContainEqual({ type: 'thinking', text: 'I have the result.' });
  });

  it('filters resume hint from stderr', async () => {
    mockSpawn({
      stdout: 'result',
      stderr: 'To resume this session: kimi -r session-123',
    });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('To resume this session') })
    );
  });

  it('emits complete event with exit code', async () => {
    mockSpawn({ stdout: 'done', exitCode: 0 });
    const runner = new KimiCodeTextRunner({ binary: 'kimi' });
    const events: unknown[] = [];
    for await (const event of runner.run({ sessionId: 's1', workdir: '/tmp' }, 'hi')) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: 'complete', exitCode: 0 });
  });
});
