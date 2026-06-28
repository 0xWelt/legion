import { spawn } from 'node:child_process';
import type { AgentConfig, AgentEvent, AgentRunner, SessionContext } from 'legion-api';

// Event/item types are based on codex-rs exec JSONL output.
// Reference: codex-source/sdk/typescript/src/{events,items}.ts and
// codex-source/codex-rs/exec/src/exec_events.rs

interface CodexThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
}

interface CodexTurnStartedEvent {
  type: 'turn.started';
}

interface CodexTurnFailedEvent {
  type: 'turn.failed';
  error: { message: string };
}

interface CodexThreadErrorEvent {
  type: 'error';
  message: string;
}

interface CodexUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

interface CodexTurnCompletedEvent {
  type: 'turn.completed';
  usage: CodexUsage;
}

interface CodexCommandExecutionItem {
  id: string;
  type: 'command_execution';
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: 'in_progress' | 'completed' | 'failed';
}

interface CodexAgentMessageItem {
  id: string;
  type: 'agent_message';
  text: string;
}

interface CodexReasoningItem {
  id: string;
  type: 'reasoning';
  text: string;
}

interface CodexFileChangeItem {
  id: string;
  type: 'file_change';
  changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>;
  status: 'completed' | 'failed';
}

interface CodexMcpToolCallItem {
  id: string;
  type: 'mcp_tool_call';
  server: string;
  tool: string;
  arguments: unknown;
  result?: { content: unknown[]; structured_content: unknown };
  error?: { message: string };
  status: 'in_progress' | 'completed' | 'failed';
}

interface CodexWebSearchItem {
  id: string;
  type: 'web_search';
  query: string;
}

interface CodexTodoListItem {
  id: string;
  type: 'todo_list';
  items: Array<{ text: string; completed: boolean }>;
}

interface CodexErrorItem {
  id: string;
  type: 'error';
  message: string;
}

type CodexThreadItem =
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexWebSearchItem
  | CodexTodoListItem
  | CodexErrorItem;

interface CodexItemStartedEvent {
  type: 'item.started';
  item: CodexThreadItem;
}

interface CodexItemUpdatedEvent {
  type: 'item.updated';
  item: CodexThreadItem;
}

interface CodexItemCompletedEvent {
  type: 'item.completed';
  item: CodexThreadItem;
}

type CodexEvent =
  | CodexThreadStartedEvent
  | CodexTurnStartedEvent
  | CodexTurnFailedEvent
  | CodexThreadErrorEvent
  | CodexTurnCompletedEvent
  | CodexItemStartedEvent
  | CodexItemUpdatedEvent
  | CodexItemCompletedEvent;

export class CodexRunner implements AgentRunner {
  readonly name = 'codex';
  private process: ReturnType<typeof spawn> | null = null;

  constructor(private readonly config: AgentConfig) {}

  async *run(ctx: SessionContext, prompt: string): AsyncIterable<AgentEvent> {
    const args = this.buildArgs(ctx);
    const cwd = ctx.workdir;
    const binary = this.config.binary ?? 'codex';
    const timeoutMs = 300 * 1000;

    const stderrChunks: Buffer[] = [];

    this.process = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdin!.write(prompt);
    this.process.stdin!.end();
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

    const startedItems = new Set<string>();

    try {
      const lines = this.readLines(this.process.stdout!);
      const lineIterator = lines[Symbol.asyncIterator]();

      while (!controller.signal.aborted) {
        const { value: line, done } = await Promise.race([lineIterator.next(), spawnError]);
        if (done) {
          break;
        }
        const events = this.parseLine(line, startedItems);
        for (const event of events) {
          yield event;
        }
      }

      const exitCode = await this.waitForExit();
      const stderr = this.filterStderr(Buffer.concat(stderrChunks).toString('utf-8').trim());
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

  private buildArgs(ctx: SessionContext): string[] {
    const args = [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      ...(this.config.model ? ['-m', String(this.config.model)] : []),
    ];

    if (ctx.agentSessionId) {
      args.push('resume', ctx.agentSessionId, '-');
    } else {
      args.push('-');
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

  private parseLine(line: string, startedItems: Set<string>): AgentEvent[] {
    try {
      const data = JSON.parse(line) as CodexEvent;

      switch (data.type) {
        case 'thread.started':
          return [{ type: 'session_init', agentSessionId: data.thread_id }];
        case 'turn.failed':
          return [{ type: 'error', message: data.error.message, fatal: true }];
        case 'error':
          return [{ type: 'error', message: data.message, fatal: true }];
        case 'item.started':
          return this.parseItemStarted(data.item, startedItems);
        case 'item.updated':
          return this.parseItemUpdated(data.item, startedItems);
        case 'item.completed':
          return this.parseItemCompleted(data.item, startedItems);
        case 'turn.completed':
          return [this.parseUsage(data.usage)];
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  private parseItemStarted(item: CodexThreadItem, startedItems: Set<string>): AgentEvent[] {
    startedItems.add(item.id);
    switch (item.type) {
      case 'agent_message':
      case 'todo_list':
        return [];
      case 'reasoning':
        return [{ type: 'thinking', text: item.text }];
      case 'command_execution':
        return [
          {
            type: 'tool_call',
            toolId: item.id,
            toolName: 'command_execution',
            input: { command: item.command },
          },
        ];
      case 'file_change':
        return [
          {
            type: 'tool_call',
            toolId: item.id,
            toolName: 'file_change',
            input: { changes: item.changes },
          },
        ];
      case 'mcp_tool_call':
        return [
          {
            type: 'tool_call',
            toolId: item.id,
            toolName: `mcp:${item.server}:${item.tool}`,
            input: item.arguments,
          },
        ];
      case 'web_search':
        return [
          {
            type: 'tool_call',
            toolId: item.id,
            toolName: 'web_search',
            input: { query: item.query },
          },
        ];
      case 'error':
        return [{ type: 'error', message: item.message, fatal: false }];
      default:
        return [];
    }
  }

  private parseItemUpdated(item: CodexThreadItem, startedItems: Set<string>): AgentEvent[] {
    // item.updated is primarily an internal progress signal; terminal state comes via
    // item.completed. We track that we have seen the item so completed does not re-emit.
    startedItems.add(item.id);
    return [];
  }

  private parseItemCompleted(item: CodexThreadItem, startedItems: Set<string>): AgentEvent[] {
    switch (item.type) {
      case 'agent_message':
        return [{ type: 'text', text: item.text }];
      case 'reasoning':
        return [{ type: 'thinking', text: item.text }];
      case 'todo_list':
        return [];
      case 'error':
        return [{ type: 'error', message: item.message, fatal: false }];
      case 'command_execution': {
        const events: AgentEvent[] = [];
        if (!startedItems.has(item.id)) {
          startedItems.add(item.id);
          events.push({
            type: 'tool_call',
            toolId: item.id,
            toolName: 'command_execution',
            input: { command: item.command },
          });
        }
        events.push({
          type: 'tool_result',
          toolId: item.id,
          output: item.aggregated_output,
        });
        return events;
      }
      case 'file_change': {
        const events: AgentEvent[] = [];
        if (!startedItems.has(item.id)) {
          startedItems.add(item.id);
          events.push({
            type: 'tool_call',
            toolId: item.id,
            toolName: 'file_change',
            input: { changes: item.changes },
          });
        }
        events.push({
          type: 'tool_result',
          toolId: item.id,
          output: item.status === 'failed' ? 'failed' : 'completed',
        });
        return events;
      }
      case 'mcp_tool_call': {
        const events: AgentEvent[] = [];
        if (!startedItems.has(item.id)) {
          startedItems.add(item.id);
          events.push({
            type: 'tool_call',
            toolId: item.id,
            toolName: `mcp:${item.server}:${item.tool}`,
            input: item.arguments,
          });
        }
        const output = item.error
          ? item.error.message
          : item.result
            ? JSON.stringify(item.result.structured_content ?? item.result.content)
            : '';
        events.push({
          type: 'tool_result',
          toolId: item.id,
          output,
        });
        return events;
      }
      case 'web_search': {
        const events: AgentEvent[] = [];
        if (!startedItems.has(item.id)) {
          startedItems.add(item.id);
          events.push({
            type: 'tool_call',
            toolId: item.id,
            toolName: 'web_search',
            input: { query: item.query },
          });
        }
        return events;
      }
      default:
        return [];
    }
  }

  private filterStderr(stderr: string): string {
    return stderr.replace(/^Reading additional input from stdin\.\.\.\s*\n?/m, '').trim();
  }

  private parseUsage(usage: CodexUsage): AgentEvent {
    return {
      type: 'usage',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cached_input_tokens,
      cacheCreationTokens: 0,
      costUsd: undefined,
    };
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
