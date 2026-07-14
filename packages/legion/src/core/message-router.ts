import type { AgentRunnerFactory } from '../agent/types.js';
import type { IMMessage } from '../im/types.js';
import type { Command } from './command-parser.js';
import { CommandParser } from './command-parser.js';
import type { SessionManager } from './session-manager.js';
import type { Session } from './types.js';

export interface RouteResult {
  type: 'command' | 'prompt';
  session: Session;
  command?: Command;
  prompt?: string;
  response?: string;
}

export interface MessageRouter {
  route(msg: IMMessage): Promise<RouteResult>;
}

export interface MessageRouterDeps {
  sessionManager: SessionManager;
  runnerFactory: AgentRunnerFactory;
  defaultAgent: string;
}

export class LegionMessageRouter implements MessageRouter {
  private readonly commandParser = new CommandParser();
  private defaultAgent: string;

  constructor(private readonly deps: MessageRouterDeps) {
    this.defaultAgent = deps.defaultAgent;
  }

  setDefaultAgent(agent: string): void {
    this.defaultAgent = agent;
  }

  async route(msg: IMMessage): Promise<RouteResult> {
    const command = this.commandParser.parse(msg.content);
    const session = this.resolveSession(msg);

    if (command.type !== 'unknown') {
      return { type: 'command', session, command };
    }

    if (!session.path) {
      return {
        type: 'command',
        session,
        command: { type: 'unknown' },
        response: '当前 session 尚未绑定 workdir。请使用 `/workdir <path>` 绑定。',
      };
    }

    return { type: 'prompt', session, prompt: msg.content };
  }

  private resolveSession(msg: IMMessage): Session {
    const existing = this.deps.sessionManager.get(msg.sessionId);
    if (existing) {
      this.deps.sessionManager.touch(msg.sessionId);
      return existing;
    }

    return this.deps.sessionManager.create(msg.sessionId, msg.provider, 'main', this.defaultAgent);
  }
}
