import type {
  AgentEvent,
  IMCommandDefinition,
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMTarget,
  IMThread,
  IMEmbed,
  RenderState,
} from '@0xwelt/legion-api';
import type { WebUIConfig } from './types.js';
import type { WebUIServer } from './server.js';

export class WebUIProvider implements IMProvider {
  readonly name = 'webui';

  private messageHandler?: (msg: IMMessage) => void | Promise<void>;
  private threadCreateHandler?: (thread: IMThread) => void | Promise<void>;
  private threadDeleteHandler?: (threadId: string) => void | Promise<void>;
  private threadArchiveHandler?: (threadId: string, archived: boolean) => void | Promise<void>;

  constructor(
    private readonly config: WebUIConfig,
    private readonly server: WebUIServer,
    private readonly staticRoot?: string
  ) {}

  registerCommands(commands: IMCommandDefinition[]): void {
    this.server.broadcast({ type: 'commands', commands });
  }

  async start(): Promise<void> {
    this.server.onMessage((payload) => {
      const { channelId, threadId, content, authorName, authorId } = payload;
      const msg: IMMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        provider: this.name,
        channelId,
        threadId,
        authorId: authorId ?? 'user',
        authorName: authorName ?? 'User',
        content,
        createdAt: new Date(),
      };
      void this.messageHandler?.(msg);
    });

    this.server.onThreadCreate((payload) => {
      const thread: IMThread = {
        id: payload.threadId,
        provider: this.name,
        channelId: payload.channelId,
        name: payload.name,
        createdAt: new Date(),
      };
      void this.threadCreateHandler?.(thread);
    });

    this.server.onThreadDelete((threadId) => {
      void this.threadDeleteHandler?.(threadId);
    });

    this.server.onThreadArchive((payload) => {
      void this.threadArchiveHandler?.(payload.threadId, payload.archived);
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

  onThreadCreate(handler: (thread: IMThread) => void | Promise<void>): void {
    this.threadCreateHandler = handler;
  }

  onThreadDelete(handler: (threadId: string) => void | Promise<void>): void {
    this.threadDeleteHandler = handler;
  }

  onThreadArchive(handler: (threadId: string, archived: boolean) => void | Promise<void>): void {
    this.threadArchiveHandler = handler;
  }

  async sendText(target: IMTarget, text: string): Promise<IMMessageRef> {
    const ref: IMMessageRef = {
      provider: this.name,
      channelId: target.channelId,
      threadId: target.threadId,
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
      channelId: target.channelId,
      threadId: target.threadId,
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
}
