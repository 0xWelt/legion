import type { AgentRunnerFactory } from '../agent/types.js';
import type { IMMessage, IMThread } from '../im/types.js';
import type { Command } from './command-parser.js';
import { CommandParser } from './command-parser.js';
import type { SessionManager } from './session-manager.js';
import type { Session } from './types.js';
import type { WorkdirManager } from './workdir-manager.js';

export interface RouteResult {
  type: 'command' | 'prompt';
  session: Session;
  command?: Command;
  prompt?: string;
  response?: string;
}

export interface MessageRouter {
  route(msg: IMMessage): Promise<RouteResult>;
  onThreadCreate(thread: IMThread): Promise<void>;
}

export interface MessageRouterDeps {
  workdirManager: WorkdirManager;
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
    const workdir = this.resolveWorkdir(msg);

    if (!workdir) {
      if (command.type === 'workdir' && command.path) {
        const session = this.deps.sessionManager.createMain(
          msg.channelId,
          'main',
          msg.channelId,
          this.defaultAgent
        );
        return { type: 'command', session, command };
      }

      if (command.type === 'help') {
        const session = this.deps.sessionManager.createMain(
          msg.channelId,
          'main',
          msg.channelId,
          this.defaultAgent
        );
        return { type: 'command', session, command };
      }

      return {
        type: 'command',
        session: this.deps.sessionManager.createMain(
          msg.channelId,
          'unknown',
          msg.channelId,
          this.defaultAgent
        ),
        command: { type: 'unknown' },
        response: '未找到 workdir：该 Channel 尚未绑定 workdir。请使用 `/workdir <path>` 绑定。',
      };
    }

    const session = this.resolveSession(msg, workdir.id);

    if (command.type !== 'unknown') {
      return { type: 'command', session, command };
    }

    if (!workdir.path) {
      return {
        type: 'command',
        session,
        command: { type: 'unknown' },
        response: 'workdir 尚未绑定。请使用 `/workdir <path>` 绑定。',
      };
    }

    return { type: 'prompt', session, prompt: msg.content };
  }

  async onThreadCreate(thread: IMThread): Promise<void> {
    const workdir = this.deps.workdirManager.get(thread.channelId);
    if (!workdir) {
      return;
    }

    const existing = this.deps.sessionManager.get(thread.id);
    if (!existing) {
      this.deps.sessionManager.createThread(
        thread.id,
        thread.name,
        workdir.id,
        workdir.defaultAgent ?? this.defaultAgent
      );
    }
  }

  private resolveWorkdir(msg: IMMessage) {
    return this.deps.workdirManager.get(msg.channelId);
  }

  private resolveSession(msg: IMMessage, workdirId: string) {
    const sessionId = msg.threadId ?? msg.channelId;
    const existing = this.deps.sessionManager.get(sessionId);
    if (existing) {
      this.deps.sessionManager.touch(sessionId);
      return existing;
    }

    const workdir = this.deps.workdirManager.get(workdirId);
    const agent = workdir?.defaultAgent ?? this.defaultAgent;

    if (msg.threadId) {
      return this.deps.sessionManager.createThread(
        sessionId,
        `thread-${sessionId.slice(-4)}`,
        workdirId,
        agent
      );
    }

    return this.deps.sessionManager.createMain(sessionId, 'main', workdirId, agent);
  }
}
