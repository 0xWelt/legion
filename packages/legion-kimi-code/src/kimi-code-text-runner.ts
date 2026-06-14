import { spawn } from 'node:child_process';
import type { AgentConfig, AgentEvent, AgentRunner, SessionContext } from 'legion';

interface Queue {
  events: AgentEvent[];
  resolve: (() => void) | null;
}

export class KimiCodeTextRunner implements AgentRunner {
  readonly name = 'kimi-code-text';
  private process: ReturnType<typeof spawn> | null = null;

  constructor(private readonly config: AgentConfig) {}

  async *run(ctx: SessionContext, prompt: string): AsyncIterable<AgentEvent> {
    const args = this.buildArgs(ctx, prompt);
    const cwd = ctx.workdir;
    const binary = this.config.binary ?? 'kimi';
    const timeoutMs = 300 * 1000;

    this.process = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: Queue = { events: [], resolve: null };
    let readersDone = 0;
    let readersError: Error | null = null;

    const push = (event: AgentEvent): void => {
      queue.events.push(event);
      if (queue.resolve) {
        queue.resolve();
        queue.resolve = null;
      }
    };

    const notifyDone = (): void => {
      readersDone += 1;
      if (queue.resolve) {
        queue.resolve();
        queue.resolve = null;
      }
    };

    const handleError = (err: Error): void => {
      readersError = err;
      if (queue.resolve) {
        queue.resolve();
        queue.resolve = null;
      }
    };

    const stdoutReader = (async (): Promise<void> => {
      let accumulated = '';
      for await (const chunk of this.process!.stdout!) {
        accumulated += String(chunk);
        if (accumulated.length > 0) {
          push({ type: 'text', text: this.formatStdout(accumulated) });
        }
      }
      notifyDone();
    })().catch(handleError);

    const stderrReader = (async (): Promise<void> => {
      const toolBuffer: string[] = [];
      const flushTool = (): void => {
        if (toolBuffer.length === 0) return;
        push({ type: 'tool_result', toolId: 'unknown', output: toolBuffer.join('\n') });
        toolBuffer.length = 0;
      };

      const lines = this.readLines(this.process!.stderr!);
      const lineIterator = lines[Symbol.asyncIterator]();
      let pendingLine: string | undefined;

      const nextLine = async (): Promise<string | undefined> => {
        if (pendingLine !== undefined) {
          const line = pendingLine;
          pendingLine = undefined;
          return line;
        }
        const result = await lineIterator.next();
        return result.done ? undefined : result.value;
      };

      const putBack = (line: string): void => {
        pendingLine = line;
      };

      while (true) {
        const line = await nextLine();
        if (line === undefined) {
          break;
        }
        if (line.startsWith('To resume this session:')) {
          continue;
        }
        if (line.startsWith('• ')) {
          flushTool();
          const thinkingLines = [line.slice(2).trim()];
          while (true) {
            const continuation = await nextLine();
            if (continuation === undefined) {
              break;
            }
            if (continuation.startsWith(' ') || continuation.startsWith('\t')) {
              thinkingLines.push(continuation.trim());
            } else {
              putBack(continuation);
              break;
            }
          }
          push({ type: 'thinking', text: thinkingLines.join('\n') });
        } else if (this.isReasoningLine(line)) {
          flushTool();
          push({ type: 'thinking', text: line });
        } else {
          toolBuffer.push(line);
        }
      }
      flushTool();
      notifyDone();
    })().catch(handleError);

    const timeout = setTimeout(() => {
      this.kill();
    }, timeoutMs);

    try {
      while (readersDone < 2 || queue.events.length > 0) {
        if (queue.events.length > 0) {
          yield queue.events.shift()!;
          continue;
        }
        if (readersError) {
          throw readersError;
        }
        if (readersDone >= 2) {
          break;
        }
        await new Promise<void>((resolve) => {
          queue.resolve = resolve;
        });
      }

      const exitCode = await this.waitForExit();
      yield { type: 'complete', exitCode };
    } finally {
      clearTimeout(timeout);
      await Promise.all([stdoutReader, stderrReader]).catch(() => {});
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
    const args = ['-p', prompt, '--output-format', 'text'];
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

  private formatStdout(text: string): string {
    // Kimi text mode prefixes the assistant response with a bullet marker.
    return text.replace(/^\s*•\s*/, '');
  }

  private isReasoningLine(line: string): boolean {
    const reasoningPatterns = [
      /^I['’]?ll\b/i,
      /^I\b/i,
      /^The\b/i,
      /^This\b/i,
      /^Now\b/i,
      /^But\b/i,
      /^So\b/i,
      /^However\b/i,
      /^让我/,
      /^我应该/,
      /^所以/,
      /^现在/,
      /^我已经/,
      /^我直接/,
      /^我整理/,
      /^我总结/,
      /^我给出/,
      /^我回答/,
      /^我会/,
      /^我将/,
      /^我想/,
      /^我需要/,
      /^我看看/,
      /^我可以用/,
      /^我可以/,
      /^我已/,
    ];
    return reasoningPatterns.some((pattern) => pattern.test(line));
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
