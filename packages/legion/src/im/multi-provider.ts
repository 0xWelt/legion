import type {
  AgentEvent,
  IMCommandDefinition,
  IMEmbed,
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMTarget,
  RenderState,
} from '@0xwelt/legion-api';

/**
 * Aggregate multiple IM providers behind a single {@link IMProvider} interface.
 *
 * Use this when the gateway should listen to more than one IM channel at the
 * same time — for example, the built-in Web UI plus an external Discord/Lark
 * provider. The multi-provider records which provider a message came from
 * and routes replies back to the same provider.
 */
export class MultiIMProvider implements IMProvider {
  readonly name = 'multi';

  private readonly messageProviders = new Map<string, IMProvider>();

  private messageHandler?: (msg: IMMessage) => void | Promise<void>;

  constructor(private readonly providers: IMProvider[]) {}

  registerCommands(commands: IMCommandDefinition[]): void {
    for (const provider of this.providers) {
      provider.registerCommands?.(commands);
    }
  }

  async start(): Promise<void> {
    for (const provider of this.providers) {
      provider.onMessage((msg) => this.recordSourceAndHandle(msg));
    }
    await Promise.all(this.providers.map((p) => p.start()));
  }

  onMessage(handler: (msg: IMMessage) => void | Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendText(target: IMTarget, text: string): Promise<IMMessageRef> {
    const provider = this.resolveProvider(target);
    return provider.sendText(target, text);
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
    return provider.sendEmbed(target, embed);
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
    return provider.sendTyping(target);
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    const provider = this.resolveProvider(target);
    return provider.renderEvent(target, event, state);
  }

  private recordSourceAndHandle(msg: IMMessage): void {
    const provider = this.providerByName(msg.provider);
    if (provider) {
      this.messageProviders.set(msg.id, provider);
    }
    void this.messageHandler?.(msg);
  }

  private resolveProvider(target: IMTarget): IMProvider {
    if (target.replyToMessageId) {
      const byMessage = this.messageProviders.get(target.replyToMessageId);
      if (byMessage) return byMessage;
    }
    const byName = this.providerByName(target.provider);
    if (byName) return byName;
    if (this.providers.length === 0) {
      throw new Error('No IM providers registered');
    }
    return this.providers[0]!;
  }

  private providerByName(name: string): IMProvider | undefined {
    return this.providers.find((p) => p.name === name);
  }
}
