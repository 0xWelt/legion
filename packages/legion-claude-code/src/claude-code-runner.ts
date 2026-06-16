import { spawn } from 'node:child_process';
import type { AgentConfig, AgentEvent, AgentRunner, SessionContext } from 'legion-api';

interface ClaudeSystemEvent {
  type: 'system';
  subtype: 'init';
  session_id?: string;
}

interface ClaudeThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: Array<ClaudeThinkingBlock | ClaudeTextBlock | ClaudeToolUseBlock>;
  };
}

interface ClaudeUserEvent {
  type: 'user';
  message: {
    role: 'user';
    content: ClaudeToolResultBlock[];
  };
}

interface ClaudeModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

interface ClaudeResultEvent {
  type: 'result';
  subtype: 'success' | 'error';
  is_error?: boolean;
  api_error_status?: string | null;
  result?: string;
  session_id?: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage: Record<string, ClaudeModelUsage>;
}

type ClaudeEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeUserEvent | ClaudeResultEvent;

export class ClaudeCodeRunner implements AgentRunner {
  readonly name = 'claude-code';
  private process: ReturnType<typeof spawn> | null = null;

  constructor(private readonly config: AgentConfig) {}

  async *run(ctx: SessionContext, prompt: string): AsyncIterable<AgentEvent> {
    const args = this.buildArgs(ctx, prompt);
    const cwd = ctx.workdir;
    const binary = this.config.binary ?? 'claude';
    const timeoutMs = 300 * 1000;

    this.process = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      (this.config.permissionMode as string | undefined) ?? 'bypassPermissions',
    ];
    if (ctx.agentSessionId) {
      args.push('--resume', ctx.agentSessionId);
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
      const data = JSON.parse(line) as ClaudeEvent;

      if (data.type === 'system' && data.subtype === 'init') {
        const sessionId = data.session_id;
        if (sessionId) {
          return [{ type: 'session_init', agentSessionId: sessionId }];
        }
        return [];
      }

      if (data.type === 'assistant') {
        return this.parseAssistantMessage(data.message.content);
      }

      if (data.type === 'user') {
        return this.parseUserMessage(data.message.content);
      }

      if (data.type === 'result') {
        return this.parseResultEvent(data);
      }

      return [];
    } catch {
      return [];
    }
  }

  private parseAssistantMessage(
    content: Array<ClaudeThinkingBlock | ClaudeTextBlock | ClaudeToolUseBlock>
  ): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === 'thinking') {
        events.push({ type: 'thinking', text: block.thinking });
      } else if (block.type === 'text') {
        events.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool_call',
          toolId: block.id,
          toolName: block.name,
          input: block.input ?? {},
        });
      }
    }
    return events;
  }

  private parseUserMessage(content: ClaudeToolResultBlock[]): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        events.push({
          type: 'tool_result',
          toolId: block.tool_use_id ?? 'unknown',
          output: block.content ?? '',
        });
      }
    }
    return events;
  }

  private parseResultEvent(data: ClaudeResultEvent): AgentEvent[] {
    const events: AgentEvent[] = [];

    events.push({ type: 'usage', ...this.extractUsage(data) });

    if (data.subtype === 'error' || data.is_error) {
      events.push({
        type: 'error',
        message: data.api_error_status ?? data.result ?? 'Claude Code returned an error',
        fatal: true,
      });
    }

    return events;
  }

  private extractUsage(data: ClaudeResultEvent): {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    costUsd?: number;
  } {
    const modelUsage = this.firstModelUsage(data.modelUsage);
    return {
      inputTokens: modelUsage.inputTokens,
      outputTokens: modelUsage.outputTokens,
      cacheReadTokens: modelUsage.cacheReadInputTokens,
      cacheCreationTokens: modelUsage.cacheCreationInputTokens,
      costUsd: modelUsage.costUSD,
    };
  }

  private firstModelUsage(modelUsage: Record<string, ClaudeModelUsage>): ClaudeModelUsage {
    const keys = Object.keys(modelUsage);
    return modelUsage[keys[0]!];
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
