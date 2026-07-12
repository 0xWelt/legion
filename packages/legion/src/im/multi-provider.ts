import type {
  AgentEvent,
  IMCommandDefinition,
  IMEmbed,
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMTarget,
  IMThread,
  RenderState,
} from '@0xwelt/legion-api';

/**
 * Aggregate multiple IM providers behind a single {@link IMProvider} interface.
 *
 * Use this when the gateway should listen to more than one IM channel at the
 * same time — for example, the built-in Web UI plus an external Discord/Lark
 * provider. The multi-provider tracks which provider a message/thread came from
 * and routes replies back to the same provider.
 */
export class MultiIMProvider implements IMProvider {
  readonly name = 'multi';

  private readonly messageProviders = new Map<string, IMProvider>();
  private readonly threadProviders = new Map<string, IMProvider>();

  private messageHandler?: (msg: IMMessage) => void | Promise<void>;
  private threadCreateHandler?: (thread: IMThread) => void | Promise<void>;
  private threadDeleteHandler?: (threadId: string) => void | Promise<void>;
  private threadArchiveHandler?: (threadId: string, archived: boolean) => void | Promise<void>;

  constructor(private readonly providers: IMProvider[]) {}

  registerCommands(commands: IMCommandDefinition[]): void {
    for (const provider of this.providers) {
      provider.registerCommands?.(commands);
    }
  }

  async start(): Promise<void> {
    for (const provider of this.providers) {
      provider.onMessage((msg) => this.recordSourceAndHandle(msg));
      provider.onThreadCreate((thread) => this.recordThreadAndHandle(thread));
      provider.onThreadDelete((threadId) => this.threadDeleteHandler?.(threadId));
      provider.onThreadArchive((threadId, archived) =>
        this.threadArchiveHandler?.(threadId, archived)
      );
    }
    await Promise.all(this.providers.map((p) => p.start()));
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
    const provider = this.resolveProvider(target);
    if (provider) {
      return provider.sendText(target, text);
    }
    return this.broadcast((p, t) => p.sendText(t, text), target);
  }

  async editText(ref: IMMessageRef, text: string): Promise<void> {
    const provider = this.providerByName(ref.provider);
    if (provider) {
      return provider.editText(ref, text);
    }
    await Promise.all(this.providers.map((p) => p.editText(ref, text)));
  }

  async sendEmbed(target: IMTarget, embed: IMEmbed): Promise<IMMessageRef> {
    const provider = this.resolveProvider(target);
    if (provider) {
      return provider.sendEmbed(target, embed);
    }
    return this.broadcast((p, t) => p.sendEmbed(t, embed), target);
  }

  async editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void> {
    const provider = this.providerByName(ref.provider);
    if (provider) {
      return provider.editEmbed(ref, embed);
    }
    await Promise.all(this.providers.map((p) => p.editEmbed(ref, embed)));
  }

  async sendTyping(target: IMTarget): Promise<void> {
    const provider = this.resolveProvider(target);
    if (provider) {
      return provider.sendTyping(target);
    }
    await Promise.all(this.providers.map((p) => p.sendTyping(target)));
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    const provider =
      this.resolveProvider(target) ?? this.providerByName(state.replyMessageRef?.provider ?? '');
    if (provider) {
      return provider.renderEvent(target, event, state);
    }
    // Broadcast and return the state from the first provider as the canonical
    // accumulated state. Multi-provider dev scenarios are rare enough that this
    // simplification is acceptable.
    let result = state;
    for (const p of this.providers) {
      result = await p.renderEvent(target, event, result);
    }
    return result;
  }

  private recordSourceAndHandle(msg: IMMessage): void {
    const provider = this.providerByName(msg.provider);
    if (provider) {
      this.messageProviders.set(msg.id, provider);
      if (msg.threadId) {
        this.threadProviders.set(msg.threadId, provider);
      }
    }
    void this.messageHandler?.(msg);
  }

  private recordThreadAndHandle(thread: IMThread): void {
    const provider = this.providerByName(thread.provider);
    if (provider) {
      this.threadProviders.set(thread.id, provider);
    }
    void this.threadCreateHandler?.(thread);
  }

  private resolveProvider(target: IMTarget): IMProvider | undefined {
    if (target.replyToMessageId) {
      const byMessage = this.messageProviders.get(target.replyToMessageId);
      if (byMessage) return byMessage;
    }
    if (target.threadId) {
      return this.threadProviders.get(target.threadId);
    }
    return undefined;
  }

  private providerByName(name: string): IMProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }

  private async broadcast(
    fn: (provider: IMProvider, target: IMTarget) => Promise<IMMessageRef>,
    target: IMTarget
  ): Promise<IMMessageRef> {
    if (this.providers.length === 0) {
      throw new Error('No IM providers registered');
    }
    const results = await Promise.all(this.providers.map((p) => fn(p, target)));
    return results[0];
  }
}
