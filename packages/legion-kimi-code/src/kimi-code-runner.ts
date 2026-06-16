import { spawn } from 'node:child_process';
import type { AgentConfig, AgentEvent, AgentRunner, SessionContext } from 'legion-api';

interface KimiMetaEvent {
  role: 'meta';
  type?: string;
  session_id?: string;
  session?: {
    resume_hint?: {
      session_id?: string;
    };
  };
}

interface KimiAssistantEvent {
  role: 'assistant';
  content?: string;
  tool_calls?: Array<{
    type?: string;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface KimiToolEvent {
  role: 'tool';
  tool_call_id?: string;
  name?: string;
  content?: string;
  input?: unknown;
}

type KimiEvent = KimiMetaEvent | KimiAssistantEvent | KimiToolEvent;

export class KimiCodeRunner implements AgentRunner {
  readonly name = 'kimi-code';
  private process: ReturnType<typeof spawn> | null = null;

  constructor(private readonly config: AgentConfig) {}

  async *run(ctx: SessionContext, prompt: string): AsyncIterable<AgentEvent> {
    const args = this.buildArgs(ctx, prompt);
    const cwd = ctx.workdir;
    const binary = this.config.binary ?? 'kimi';
    const timeoutMs = 300 * 1000;

    const stderrChunks: Buffer[] = [];

    this.process = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    const spawnError = new Promise<never>((_, reject) => {
      this.process!.on('error', (err) => {
        reject(new Error(`Failed to spawn ${binary}: ${err.message}`));
      });
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      this.kill();
    }, timeoutMs);

    try {
      const lines = this.readLines(this.process.stdout!);
      const lineIterator = lines[Symbol.asyncIterator]();

      while (!controller.signal.aborted) {
        const { value: line, done } = await Promise.race([lineIterator.next(), spawnError]);
        if (done) {
          break;
        }
        const events = this.parseLine(line);
        for (const event of events) {
          yield event;
        }
      }

      const exitCode = await this.waitForExit();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
      if (stderr) {
        yield { type: 'error', message: stderr, fatal: true };
      }
      yield { type: 'complete', exitCode };
    } finally {
      clearTimeout(timeout);
      this.process = null;
    }
  }

  async interrupt(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGINT');
    }
  }

  async kill(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill('SIGKILL');
    }
  }

  private buildArgs(ctx: SessionContext, prompt: string): string[] {
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (ctx.agentSessionId) {
      args.push('--session', ctx.agentSessionId);
    }
    return args;
  }

  private async *readLines(stream: NodeJS.ReadableStream): AsyncIterable<string> {
    let buffer = '';
    for await (const chunk of stream) {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          yield line;
        }
      }
    }
    if (buffer.trim()) {
      yield buffer;
    }
  }

  private parseLine(line: string): AgentEvent[] {
    try {
      const data = JSON.parse(line) as KimiEvent;

      if (data.role === 'meta') {
        const sessionId = data.session_id ?? data.session?.resume_hint?.session_id;
        if (sessionId) {
          return [{ type: 'session_init', agentSessionId: sessionId }];
        }
        return [];
      }

      if (data.role === 'assistant') {
        const events: AgentEvent[] = [];
        if (data.tool_calls && data.tool_calls.length > 0) {
          for (const call of data.tool_calls) {
            events.push({
              type: 'tool_call',
              toolId: call.id ?? 'unknown',
              toolName: call.function?.name ?? 'unknown',
              input: this.parseToolInput(call.function?.arguments),
            });
          }
        }
        if (data.content) {
          events.push({ type: 'text', text: data.content });
        }
        return events;
      }

      if (data.role === 'tool') {
        if (data.content !== undefined) {
          return [
            {
              type: 'tool_result',
              toolId: data.tool_call_id ?? 'unknown',
              output: data.content,
            },
          ];
        }
        return [
          {
            type: 'tool_call',
            toolId: data.tool_call_id ?? 'unknown',
            toolName: data.name ?? 'unknown',
            input: data.input ?? {},
          },
        ];
      }

      return [];
    } catch {
      return [];
    }
  }

  private parseToolInput(input?: string): unknown {
    if (!input) {
      return {};
    }
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }

  private waitForExit(): Promise<number> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve(0);
        return;
      }
      if (this.process.exitCode !== null) {
        resolve(this.process.exitCode);
        return;
      }
      this.process.once('exit', (code) => {
        resolve(code ?? 0);
      });
    });
  }
}
