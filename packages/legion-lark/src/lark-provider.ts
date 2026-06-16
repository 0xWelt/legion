import http from 'node:http';
import * as lark from '@larksuiteoapi/node-sdk';
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
} from 'legion-api';
import { applyEvent, buildCard, createInitialState, type CardState } from './card-builder.js';
import type { LarkProviderOptions } from './config.js';
import { parseMessageEvent } from './event-handler.js';
import type { LarkCard, LarkCreateMessageResponse, LarkMessageEvent } from './types.js';

export class LarkProvider implements IMProvider {
  readonly name = 'lark';
  private readonly client: lark.Client;
  private readonly eventDispatcher: lark.EventDispatcher;
  private messageHandlers: Array<(msg: IMMessage) => void> = [];
  private threadCreateHandlers: Array<(thread: IMThread) => void> = [];
  private threadDeleteHandlers: Array<(threadId: string) => void> = [];
  private threadArchiveHandlers: Array<(threadId: string, archived: boolean) => void> = [];
  private server?: http.Server;
  private wsClient?: lark.WSClient;
  private readonly cardStates = new Map<string, CardState>();

  constructor(private readonly options: LarkProviderOptions) {
    this.client =
      options._client ??
      new lark.Client({
        appId: options.appId,
        appSecret: options.appSecret,
        loggerLevel: lark.LoggerLevel.error,
      });
    this.eventDispatcher = new lark.EventDispatcher({
      encryptKey: options.encryptKey,
      verificationToken: options.verificationToken,
    }).register({
      'im.message.receive_v1': async (data: unknown) =>
        this.handleMessageEvent(data as LarkMessageEvent),
    });
  }

  async start(): Promise<void> {
    if (this.options.mode === 'long-connection') {
      this.wsClient =
        this.options._wsClient ??
        new lark.WSClient({
          appId: this.options.appId,
          appSecret: this.options.appSecret,
          loggerLevel: lark.LoggerLevel.error,
        });
      await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
      return;
    }

    const path = this.options.webhookPath ?? '/webhook/event';
    const handler = lark.adaptDefault(path, this.eventDispatcher, { autoChallenge: true });
    const port = this.options.webhookPort ?? 3000;
    this.server = http.createServer(handler);
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, () => resolve());
      this.server!.once('error', reject);
    });
  }

  registerCommands(_commands: IMCommandDefinition[]): void {
    // Lark does not have native slash commands; text commands are parsed by LegionCore.
  }

  onMessage(handler: (msg: IMMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onThreadCreate(handler: (thread: IMThread) => void): void {
    this.threadCreateHandlers.push(handler);
  }

  onThreadDelete(handler: (threadId: string) => void): void {
    this.threadDeleteHandlers.push(handler);
  }

  onThreadArchive(handler: (threadId: string, archived: boolean) => void): void {
    this.threadArchiveHandlers.push(handler);
  }

  async sendText(target: IMTarget, text: string): Promise<IMMessageRef> {
    const content = JSON.stringify({ text: text.trim().slice(0, 3000) });
    const messageId = await this.sendMessage(target, 'text', content);
    return this.toRef(target, messageId);
  }

  async editText(ref: IMMessageRef, text: string): Promise<void> {
    await this.editMessage(ref.messageId, JSON.stringify({ text: text.trim().slice(0, 3000) }));
  }

  async sendEmbed(target: IMTarget, embed: IMEmbed): Promise<IMMessageRef> {
    const card = this.embedToCard(embed);
    const messageId = await this.sendMessage(target, 'interactive', JSON.stringify(card));
    return this.toRef(target, messageId);
  }

  async editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void> {
    const card = this.embedToCard(embed);
    await this.editMessage(ref.messageId, JSON.stringify(card));
  }

  async sendTyping(_target: IMTarget): Promise<void> {
    // Lark does not have a typing indicator API.
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    const sessionKey = target.channelId;
    let cardState = this.cardStates.get(sessionKey) ?? createInitialState();
    cardState = applyEvent(cardState, event);
    this.cardStates.set(sessionKey, cardState);

    const card = buildCard(cardState);

    if (!state.replyMessageRef) {
      const ref = await this.sendCard(target, card);
      state.replyMessageRef = ref;
    } else {
      await this.editMessage(state.replyMessageRef.messageId, JSON.stringify(card));
    }

    if (event.type === 'complete' || event.type === 'error') {
      this.cardStates.delete(sessionKey);
    }

    return state;
  }

  private async handleMessageEvent(data: LarkMessageEvent): Promise<void> {
    const message = parseMessageEvent(data);
    if (!message) {
      return;
    }
    if (this.options.allowedChatIds && !this.options.allowedChatIds.includes(message.channelId)) {
      return;
    }
    for (const handler of this.messageHandlers) {
      await handler(message);
    }
  }

  private async sendMessage(target: IMTarget, msgType: string, content: string): Promise<string> {
    if (target.replyToMessageId) {
      return this.replyMessage(target.replyToMessageId, msgType, content);
    }
    const response = await this.client.request<LarkCreateMessageResponse>({
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages',
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: target.channelId,
        msg_type: msgType,
        content,
      },
    });
    if (response.code !== 0 || !response.data?.message_id) {
      throw new Error(`Failed to send Lark message: ${response.msg} (code=${response.code})`);
    }
    return response.data.message_id;
  }

  private async replyMessage(messageId: string, msgType: string, content: string): Promise<string> {
    const response = await this.client.request<LarkCreateMessageResponse>({
      method: 'POST',
      url: `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      data: {
        content,
        msg_type: msgType,
      },
    });
    if (response.code !== 0 || !response.data?.message_id) {
      throw new Error(`Failed to reply Lark message: ${response.msg} (code=${response.code})`);
    }
    return response.data.message_id;
  }

  private async editMessage(messageId: string, content: string): Promise<void> {
    await this.client.request<{ code: number; msg: string }>({
      method: 'PATCH',
      url: `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      data: { content },
    });
  }

  private async sendCard(target: IMTarget, card: LarkCard): Promise<IMMessageRef> {
    const messageId = await this.sendMessage(target, 'interactive', JSON.stringify(card));
    return this.toRef(target, messageId);
  }

  private toRef(target: IMTarget, messageId: string): IMMessageRef {
    return {
      provider: this.name,
      channelId: target.channelId,
      threadId: target.threadId,
      messageId,
    };
  }

  private embedToCard(embed: IMEmbed): LarkCard {
    const elements: unknown[] = [];
    if (embed.description) {
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: embed.description },
      });
    }
    if (embed.fields) {
      for (const field of embed.fields) {
        elements.push({
          tag: 'div',
          text: { tag: 'plain_text', content: `${field.name}: ${field.value}` },
        });
      }
    }
    return {
      config: { wide_screen_mode: true },
      header: {
        template: embed.color ? colorToTemplate(embed.color) : 'blue',
        title: { tag: 'plain_text', content: embed.title ?? '' },
      },
      elements,
    };
  }
}

function colorToTemplate(color: number): string {
  if (color < 0xff0000) return 'red';
  if (color < 0xffff00) return 'orange';
  if (color < 0x00ff00) return 'yellow';
  if (color < 0x00ffff) return 'green';
  if (color < 0x0000ff) return 'wathet';
  return 'blue';
}
