import type {
  AgentEvent,
  IMCommandDefinition,
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMProviderStatus,
  IMTarget,
  IMEmbed,
  RenderState,
  Session,
} from '@0xwelt/legion-api';
import type { WebUIConfig } from './types.js';
import type { WebUIServer } from './server.js';

export class WebUIProvider implements IMProvider {
  readonly name = 'webui';

  private messageHandler?: (msg: IMMessage) => void | Promise<void>;

  constructor(
    private readonly config: WebUIConfig,
    private readonly server: WebUIServer,
    private readonly staticRoot?: string
  ) {}

  getServer(): WebUIServer {
    return this.server;
  }

  getStatus(): IMProviderStatus {
    return {
      configured: true,
      summary: `host=${this.config.host ?? '127.0.0.1'}, port=${this.config.port ?? 18788}`,
    };
  }

  async checkConnection(): Promise<boolean> {
    return true;
  }

  registerCommands(commands: IMCommandDefinition[]): void {
    this.server.broadcast({ type: 'commands', commands });
  }

  async start(): Promise<void> {
    this.server.onMessage((payload) => {
      const imMsg: IMMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: this.name,
        sessionId: payload.sessionId,
        authorId: payload.authorId ?? 'user',
        authorName: payload.authorName ?? 'User',
        content: payload.content,
        createdAt: new Date(),
      };
      void this.messageHandler?.(imMsg);
    });

    await this.server.start(
      this.config.host ?? '127.0.0.1',
      this.config.port ?? 18788,
      this.staticRoot
    );
  }

  onMessage(handler: (msg: IMMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendText(target: IMTarget, text: string): Promise<IMMessageRef> {
    const ref: IMMessageRef = {
      provider: this.name,
      sessionId: target.sessionId,
      messageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    this.server.broadcast({
      type: 'text',
      target,
      text,
      messageId: ref.messageId,
    });
    return ref;
  }

  async editText(ref: IMMessageRef, text: string): Promise<void> {
    this.server.broadcast({
      type: 'edit-text',
      ref,
      text,
    });
  }

  async sendEmbed(target: IMTarget, embed: IMEmbed): Promise<IMMessageRef> {
    const ref: IMMessageRef = {
      provider: this.name,
      sessionId: target.sessionId,
      messageId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    this.server.broadcast({
      type: 'embed',
      target,
      embed,
      messageId: ref.messageId,
    });
    return ref;
  }

  async editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void> {
    this.server.broadcast({
      type: 'edit-embed',
      ref,
      embed,
    });
  }

  async sendTyping(_target: IMTarget): Promise<void> {
    this.server.broadcast({ type: 'typing' });
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    this.server.broadcast({
      type: 'agent-event',
      target,
      event,
    });
    return state;
  }

  async updateSession(target: IMTarget, session: Session): Promise<void> {
    this.server.broadcast({
      type: 'session-update',
      target,
      session,
    });
  }
}
