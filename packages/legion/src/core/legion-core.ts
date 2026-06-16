import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { AgentRunnerFactory } from '../agent/types.js';
import type { LegionConfig } from '../config/schema.js';
import { DEFAULT_CONFIG_PATH, saveConfig } from '../config/loader.js';
import type { IMMessage, IMProvider, IMTarget, IMThread, RenderState } from '../im/types.js';
import type { StateStore } from '../state/store.js';
import type { Logger } from '../utils/logger.js';
import { ConsoleLogger } from '../utils/logger.js';
import type { Command } from './command-parser.js';
import { LegionMessageRouter } from './message-router.js';
import { InMemorySessionManager } from './session-manager.js';
import type { AgentEvent, LegionState, Session, Workdir } from './types.js';
import { InMemoryWorkdirManager } from './workdir-manager.js';

export interface LegionCoreDeps {
  config: LegionConfig;
  configPath?: string;
  imProvider: IMProvider;
  runnerFactory: AgentRunnerFactory;
  stateStore: StateStore;
}

export class LegionCore {
  private readonly workdirManager: InMemoryWorkdirManager;
  private readonly sessionManager: InMemorySessionManager;
  private readonly router: LegionMessageRouter;
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private readonly logger: Logger;

  constructor(
    private readonly deps: LegionCoreDeps,
    logger?: Logger
  ) {
    this.logger = logger ?? new ConsoleLogger();
    this.workdirManager = new InMemoryWorkdirManager();
    this.sessionManager = new InMemorySessionManager();
    this.router = new LegionMessageRouter({
      workdirManager: this.workdirManager,
      sessionManager: this.sessionManager,
      runnerFactory: deps.runnerFactory,
      defaultAgent: this.resolveDefaultAgent(),
    });
  }

  async start(): Promise<void> {
    const state = this.migrateState(await this.deps.stateStore.load());
    this.workdirManager.load(state.workdirs);
    this.sessionManager.load(state.sessions);

    this.logger.info('Legion started', {
      workdirs: Object.keys(state.workdirs).length,
      sessions: Object.keys(state.sessions).length,
    });

    this.deps.imProvider.onMessage((msg) => this.handleMessage(msg));
    this.deps.imProvider.onThreadCreate((thread) => this.handleThreadCreate(thread));
    this.deps.imProvider.onThreadDelete((threadId) => this.handleThreadDelete(threadId));
    this.deps.imProvider.onThreadArchive((threadId, archived) =>
      this.handleThreadArchive(threadId, archived)
    );

    await this.deps.imProvider.start();
  }

  async handleMessage(msg: IMMessage): Promise<void> {
    this.logger.info('Received message', {
      channelId: msg.channelId,
      threadId: msg.threadId,
      author: msg.authorName,
      content: msg.content,
    });

    const route = await this.router.route(msg);
    const target: IMTarget = {
      channelId: msg.channelId,
      threadId: msg.threadId,
      replyToMessageId: msg.id,
    };

    if (route.response) {
      await this.deps.imProvider.sendText(target, route.response);
      return;
    }

    if (route.type === 'command' && route.command) {
      await this.handleCommand(target, route.session, route.command);
      return;
    }

    if (route.type === 'prompt' && route.prompt) {
      await this.handlePrompt(target, route.session, route.prompt);
    }
  }

  private async handleCommand(target: IMTarget, session: Session, command: Command): Promise<void> {
    this.logger.info('Handling command', { type: command.type, sessionId: session.id });

    switch (command.type) {
      case 'workdir': {
        if (command.path) {
          const expandedPath = expandHome(command.path);
          const validation = await this.validateWorkdir(expandedPath);
          if (!validation.valid) {
            await this.deps.imProvider.sendText(target, validation.reason);
            break;
          }
          this.workdirManager.bind(session.workdirId, session.workdirId, expandedPath);
          this.logger.info('Workdir bound', {
            workdirId: session.workdirId,
            path: expandedPath,
          });
          await this.deps.imProvider.sendText(target, `已绑定 workdir: ${expandedPath}`);
        } else {
          const workdir = this.workdirManager.get(session.workdirId);
          const reply = workdir?.path ? `当前 workdir: ${workdir.path}` : '尚未绑定 workdir';
          await this.deps.imProvider.sendText(target, reply);
        }
        break;
      }
      case 'status': {
        const workdir = this.workdirManager.get(session.workdirId);
        const lines = ['**状态**'];
        if (workdir) {
          lines.push(`- workdir: ${workdir.path ?? '未绑定'}`);
        } else {
          lines.push('- workdir: 未找到');
        }
        lines.push(
          `- IM session: ${session.id}`,
          `- agent: ${session.agent}`,
          `- agent session: ${session.agentSessionId ?? '未初始化'}`,
          `- status: ${session.status}`
        );
        await this.deps.imProvider.sendText(target, lines.join('\n'));
        break;
      }
      case 'agent': {
        if (command.name) {
          const available = this.resolveAvailableAgents();
          if (!available.includes(command.name)) {
            await this.deps.imProvider.sendText(
              target,
              `未知 agent: ${command.name}。可用: ${available.join(', ') || '无'}`
            );
            break;
          }
          switch (command.scope) {
            case 'global': {
              this.deps.config.defaultAgent = command.name;
              this.router.setDefaultAgent(command.name);
              await saveConfig(this.deps.configPath ?? DEFAULT_CONFIG_PATH, this.deps.config);
              await this.deps.imProvider.sendText(target, `已设置全局默认 agent: ${command.name}`);
              break;
            }
            case 'workdir': {
              const workdir = this.workdirManager.get(session.workdirId);
              if (!workdir) {
                await this.deps.imProvider.sendText(
                  target,
                  '当前 workdir 不存在，无法设置 workdir 级 agent'
                );
                break;
              }
              this.workdirManager.setDefaultAgent(workdir.id, command.name);
              await this.deps.imProvider.sendText(
                target,
                `已设置 workdir 默认 agent: ${command.name}`
              );
              break;
            }
            case 'session':
            default: {
              if (session.agentSessionId) {
                await this.deps.imProvider.sendText(
                  target,
                  `当前 session 已与 ${session.agent} 的 agent session 绑定，无法切换到其它 agent。如需使用 ${command.name}，请新建 thread 或在新 workdir 中开始会话。`
                );
                break;
              }
              this.sessionManager.setAgent(session.id, command.name);
              await this.deps.imProvider.sendText(
                target,
                `已切换到 session agent: ${command.name}`
              );
              break;
            }
          }
        } else {
          const scopeLabel =
            command.scope === 'global'
              ? '全局默认'
              : command.scope === 'workdir'
                ? 'workdir 默认'
                : '当前 session';
          let value: string;
          if (command.scope === 'global') {
            value = this.resolveDefaultAgent();
          } else if (command.scope === 'workdir') {
            const workdir = this.workdirManager.get(session.workdirId);
            value = workdir?.defaultAgent ?? this.resolveDefaultAgent();
          } else {
            value = session.agent;
          }
          await this.deps.imProvider.sendText(target, `${scopeLabel} agent: ${value}`);
        }
        break;
      }
      case 'help': {
        await this.deps.imProvider.sendText(
          target,
          [
            '可用命令：',
            '`/workdir <path>` — 绑定或查看当前 workdir 的工作目录',
            '`/status` — 查看当前 workdir 与 path 状态',
            '`/agent [--global|--workdir|--session] [name]` — 查看或切换 runner（默认 session）',
            '`/help` — 显示本帮助',
          ].join('\n')
        );
        break;
      }
      default: {
        await this.deps.imProvider.sendText(target, '未知命令。');
      }
    }
    await this.persist();
  }

  private async handlePrompt(target: IMTarget, session: Session, prompt: string): Promise<void> {
    this.logger.info('Handling prompt', { sessionId: session.id, prompt });

    const workdir = this.workdirManager.get(session.workdirId);
    if (!workdir?.path) {
      await this.deps.imProvider.sendText(target, 'workdir 尚未绑定。');
      return;
    }

    const available = this.resolveAvailableAgents();
    if (!available.includes(session.agent)) {
      await this.deps.imProvider.sendText(
        target,
        `当前 session 的 agent (${session.agent}) 不可用。可用: ${available.join(', ') || '无'}`
      );
      return;
    }
    const agentConfig = this.deps.config.agents?.[session.agent] ?? {};
    const runner = this.deps.runnerFactory.create(session.agent, agentConfig);
    void this.deps.imProvider.sendTyping(target);

    const work = async (): Promise<void> => {
      this.sessionManager.setStatus(session.id, 'running');
      const renderState: RenderState = {
        toolMessageRefs: new Map(),
      };

      try {
        for await (const event of runner.run(
          {
            sessionId: session.id,
            workdir: workdir.path,
            agentSessionId: session.agentSessionId,
          },
          prompt
        )) {
          this.logger.info('Agent event', {
            sessionId: session.id,
            type: event.type,
            text: event.type === 'text' ? event.text : undefined,
          });
          await this.handleAgentEvent(session, event);
          await this.deps.imProvider.renderEvent(target, event, renderState);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('Agent run failed', { sessionId: session.id, error: message });
        const errorEvent: AgentEvent = { type: 'error', message, fatal: true };
        try {
          await this.deps.imProvider.renderEvent(target, errorEvent, renderState);
          await this.deps.imProvider.renderEvent(
            target,
            { type: 'complete', exitCode: 1 },
            renderState
          );
        } catch (renderErr) {
          const renderMessage = renderErr instanceof Error ? renderErr.message : String(renderErr);
          this.logger.error('Failed to render error', {
            sessionId: session.id,
            error: renderMessage,
          });
          await this.deps.imProvider.sendText(target, `❌ ${message}`);
        }
      } finally {
        this.sessionManager.setStatus(session.id, 'idle');
        await this.persist();
      }
    };

    const previous = this.sessionQueues.get(session.id) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.sessionQueues.set(session.id, next);
    await next;
  }

  private async handleAgentEvent(session: Session, event: AgentEvent): Promise<void> {
    if (event.type === 'session_init') {
      this.sessionManager.setAgentSessionId(session.id, event.agentSessionId);
      await this.persist();
    }
  }

  private async handleThreadCreate(thread: IMThread): Promise<void> {
    this.logger.info('Thread created', { threadId: thread.id, channelId: thread.channelId });
    await this.router.onThreadCreate(thread);
    await this.persist();
  }

  private async handleThreadDelete(threadId: string): Promise<void> {
    this.logger.info('Thread deleted', { threadId });
    const session = this.sessionManager.get(threadId);
    if (session) {
      this.sessionManager.setStatus(threadId, 'idle');
      await this.persist();
    }
  }

  private async handleThreadArchive(threadId: string, archived: boolean): Promise<void> {
    this.logger.info('Thread archived', { threadId, archived });
    const session = this.sessionManager.get(threadId);
    if (session) {
      await this.persist();
    }
  }

  private resolveDefaultAgent(): string {
    if (this.deps.config.defaultAgent) {
      return this.deps.config.defaultAgent;
    }
    const registered = this.deps.runnerFactory.list();
    if (registered.length > 0) {
      return registered[0];
    }
    throw new Error('未配置 defaultAgent 且没有已注册的 runner');
  }

  private resolveAvailableAgents(): string[] {
    const fromFactory = new Set(this.deps.runnerFactory.list());
    for (const name of Object.keys(this.deps.config.agents ?? {})) {
      fromFactory.add(name);
    }
    return Array.from(fromFactory);
  }

  private async validateWorkdir(
    path: string
  ): Promise<{ valid: true } | { valid: false; reason: string }> {
    try {
      const info = await stat(path);
      if (!info.isDirectory()) {
        return { valid: false, reason: `路径不是目录: ${path}` };
      }
      return { valid: true };
    } catch {
      return { valid: false, reason: `目录不存在: ${path}` };
    }
  }

  private migrateState(state: LegionState): LegionState {
    const legacy = state as unknown as {
      workspaces?: Record<string, Workdir & { workdir?: string }>;
      workdirs?: Record<string, Workdir>;
      sessions?: Record<string, Session & { workspaceId?: string }>;
    };

    if (legacy.workspaces && !legacy.workdirs) {
      legacy.workdirs = {};
      for (const [id, workspace] of Object.entries(legacy.workspaces)) {
        const workdir: Workdir = {
          ...workspace,
          path: workspace.path ?? workspace.workdir ?? '',
        };
        legacy.workdirs[id] = workdir;
      }
    }

    if (legacy.sessions) {
      for (const session of Object.values(legacy.sessions)) {
        if (session.workspaceId !== undefined) {
          session.workdirId = session.workspaceId;
          delete session.workspaceId;
        }
      }
    }

    return {
      workdirs: legacy.workdirs ?? {},
      sessions: legacy.sessions ?? {},
    };
  }

  private async persist(): Promise<void> {
    await this.deps.stateStore.save({
      workdirs: this.workdirManager.dump(),
      sessions: this.sessionManager.dump(),
    });
    this.logger.info('State persisted');
  }
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return `${homedir()}${path.slice(1)}`;
  }
  return path;
}
