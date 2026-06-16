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

interface ClaudeStreamEvent {
  type: 'stream_event';
  event: {
    type: string;
    message?: { id: string; role: string; content: []; model: string };
    index?: number;
    content_block?: ClaudeThinkingBlock | ClaudeTextBlock | ClaudeToolUseBlock;
    delta?:
      | { type: 'text_delta'; text: string }
      | { type: 'thinking_delta'; thinking: string }
      | { type: 'signature_delta'; signature: string }
      | { type: 'input_json_delta'; partial_json: string };
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

type ClaudeEvent =
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent
  | ClaudeStreamEvent;

interface StreamState {
  textBuffer: string;
  thinkingBuffer: string;
  toolUseBlock?: { toolId: string; toolName: string; partialInput: string };
  emittedToolIds: Set<string>;
}

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

    const state: StreamState = { textBuffer: '', thinkingBuffer: '', emittedToolIds: new Set() };

    try {
      const lines = this.readLines(this.process.stdout!);
      const lineIterator = lines[Symbol.asyncIterator]();

      while (!controller.signal.aborted) {
        const { value: line, done } = await Promise.race([lineIterator.next(), spawnError]);
        if (done) {
          break;
        }
        const events = this.parseLine(line, state);
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
      '--include-partial-messages',
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

  private parseLine(line: string, state: StreamState): AgentEvent[] {
    try {
      const data = JSON.parse(line) as ClaudeEvent;

      if (data.type === 'system' && data.subtype === 'init') {
        const sessionId = data.session_id;
        if (sessionId) {
          return [{ type: 'session_init', agentSessionId: sessionId }];
        }
        return [];
      }

      if (data.type === 'stream_event') {
        return this.parseStreamEvent(data.event, state);
      }

      if (data.type === 'assistant') {
        return this.parseAssistantMessage(data.message.content, state);
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

  private parseStreamEvent(event: ClaudeStreamEvent['event'], state: StreamState): AgentEvent[] {
    switch (event.type) {
      case 'message_start': {
        state.textBuffer = '';
        state.thinkingBuffer = '';
        return [];
      }
      case 'content_block_start': {
        if (event.content_block?.type === 'text') {
          state.textBuffer = '';
        } else if (event.content_block?.type === 'thinking') {
          state.thinkingBuffer = '';
        } else if (event.content_block?.type === 'tool_use') {
          state.toolUseBlock = {
            toolId: event.content_block.id,
            toolName: event.content_block.name,
            partialInput: '',
          };
        }
        return [];
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (!delta) return [];
        if (delta.type === 'text_delta') {
          state.textBuffer += delta.text;
          return [{ type: 'text', text: state.textBuffer, delta: delta.text }];
        }
        if (delta.type === 'thinking_delta') {
          state.thinkingBuffer += delta.thinking;
          return [{ type: 'thinking', text: state.thinkingBuffer, delta: delta.thinking }];
        }
        if (delta.type === 'input_json_delta' && state.toolUseBlock) {
          state.toolUseBlock.partialInput += delta.partial_json;
          return [
            {
              type: 'tool_call_delta',
              toolId: state.toolUseBlock.toolId,
              toolName: state.toolUseBlock.toolName,
              partialInput: state.toolUseBlock.partialInput,
              delta: delta.partial_json,
            },
          ];
        }
        return [];
      }
      case 'content_block_stop': {
        if (state.toolUseBlock) {
          const toolCall = this.buildToolCallFromStream(state.toolUseBlock);
          state.emittedToolIds.add(state.toolUseBlock.toolId);
          state.toolUseBlock = undefined;
          if (toolCall) {
            return [toolCall];
          }
        }
        return [];
      }
      default:
        return [];
    }
  }

  private buildToolCallFromStream(
    toolUseBlock: NonNullable<StreamState['toolUseBlock']>
  ): AgentEvent | undefined {
    try {
      const input = JSON.parse(toolUseBlock.partialInput) as unknown;
      return {
        type: 'tool_call',
        toolId: toolUseBlock.toolId,
        toolName: toolUseBlock.toolName,
        input: input ?? {},
      };
    } catch {
      return {
        type: 'tool_call',
        toolId: toolUseBlock.toolId,
        toolName: toolUseBlock.toolName,
        input: {},
      };
    }
  }

  private parseAssistantMessage(
    content: Array<ClaudeThinkingBlock | ClaudeTextBlock | ClaudeToolUseBlock>,
    state: StreamState
  ): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === 'thinking') {
        if (!state.thinkingBuffer) {
          events.push({ type: 'thinking', text: block.thinking });
        }
      } else if (block.type === 'text') {
        if (!state.textBuffer) {
          events.push({ type: 'text', text: block.text });
        }
      } else if (block.type === 'tool_use') {
        if (!state.emittedToolIds.has(block.id)) {
          events.push({
            type: 'tool_call',
            toolId: block.id,
            toolName: block.name,
            input: block.input ?? {},
          });
          state.emittedToolIds.add(block.id);
        }
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
