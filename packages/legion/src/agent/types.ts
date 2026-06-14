import type { AgentEvent, Session } from '../core/types.js';

export interface AgentRunner {
  readonly name: string;
  run(ctx: SessionContext, prompt: string): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  kill(): Promise<void>;
}

export interface SessionContext {
  sessionId: string;
  workdir: string;
  agentSessionId?: string;
  model?: string;
  threadName?: string;
}

export interface AgentRunnerFactory {
  create(name: string, config: AgentConfig): AgentRunner;
  list(): string[];
}

export interface AgentConfig {
  binary?: string;
  model?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface RunnerState {
  session: Session;
  prompt: string;
}
