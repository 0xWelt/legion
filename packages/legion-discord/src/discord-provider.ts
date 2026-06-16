import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { buildCommandContent, buildSlashCommands } from './discord-slash-commands.js';
import type { DiscordProviderOptions } from './config.js';
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
} from 'legion-api';

export class DiscordProvider implements IMProvider {
  readonly name = 'discord';
  private readonly client: Client;
  private messageHandlers: Array<(msg: IMMessage) => void> = [];
  private threadCreateHandlers: Array<(thread: IMThread) => void> = [];
  private threadDeleteHandlers: Array<(threadId: string) => void> = [];
  private threadArchiveHandlers: Array<(threadId: string, archived: boolean) => void> = [];
  private toolNames = new Map<string, string>();
  private pendingInteractions = new Map<string, ChatInputCommandInteraction>();
  private commandDefinitions: IMCommandDefinition[] = [];
  private readonly editDebounceMs: number;

  constructor(private readonly options: DiscordProviderOptions) {
    this.editDebounceMs = options.editDebounceMs ?? 1000;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  async start(): Promise<void> {
    this.client.on('messageCreate', (msg) => {
      if (msg.author.bot) return;
      if (msg.system) return;
      if (msg.guildId !== this.options.allowedGuildId) return;

      const isThread = msg.channel.isThread();
      const parentId = isThread ? (msg.channel as ThreadChannel).parentId : null;
      const imMsg: IMMessage = {
        id: msg.id,
        provider: this.name,
        channelId: isThread && parentId ? parentId : msg.channelId,
        threadId: isThread ? msg.channelId : undefined,
        authorId: msg.author.id,
        authorName: msg.author.username,
        content: msg.content,
        createdAt: msg.createdAt,
      };

      for (const handler of this.messageHandlers) {
        handler(imMsg);
      }
    });

    this.client.on('channelCreate', (channel) => {
      if (channel.guildId !== this.options.allowedGuildId) return;
      if (!channel.isTextBased() || channel.isThread()) return;
      void (channel as TextChannel).send(this.buildWorkspaceGuide());
    });

    this.client.on('threadCreate', (thread) => {
      if (thread.guildId !== this.options.allowedGuildId) return;
      const imThread: IMThread = {
        id: thread.id,
        provider: this.name,
        channelId: thread.parentId ?? '',
        name: thread.name,
        createdAt: thread.createdAt ?? new Date(),
      };
      for (const handler of this.threadCreateHandlers) {
        handler(imThread);
      }
    });

    this.client.on('threadDelete', (thread) => {
      if (thread.guildId !== this.options.allowedGuildId) return;
      for (const handler of this.threadDeleteHandlers) {
        handler(thread.id);
      }
    });

    this.client.on('threadUpdate', (oldThread, newThread) => {
      if (newThread.guildId !== this.options.allowedGuildId) return;
      if (oldThread.archived !== newThread.archived) {
        for (const handler of this.threadArchiveHandlers) {
          handler(newThread.id, newThread.archived ?? false);
        }
      }
    });

    this.client.on('interactionCreate', (interaction) =>
      this.handleInteraction(interaction as ChatInputCommandInteraction)
    );

    await this.client.login(this.options.botToken);
    await this.registerSlashCommands();
  }

  registerCommands(commands: IMCommandDefinition[]): void {
    this.commandDefinitions = commands;
  }

  private async registerSlashCommands(): Promise<void> {
    const clientId = this.client.user?.id;
    if (!clientId || this.commandDefinitions.length === 0) {
      return;
    }

    const rest = new REST({ version: '10' }).setToken(this.options.botToken);
    try {
      await rest.put(Routes.applicationGuildCommands(clientId, this.options.allowedGuildId), {
        body: buildSlashCommands(this.commandDefinitions),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to register slash commands:', message);
    }
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId !== this.options.allowedGuildId) return;

    const content = buildCommandContent(interaction, this.commandDefinitions);
    if (!content) return;

    const channel = interaction.channel;
    const isThread = channel?.isThread();
    const parentId = isThread ? (channel as ThreadChannel).parentId : null;

    const imMsg: IMMessage = {
      id: interaction.id,
      provider: this.name,
      channelId: isThread && parentId ? parentId : interaction.channelId,
      threadId: isThread ? interaction.channelId : undefined,
      authorId: interaction.user.id,
      authorName: interaction.user.username,
      content,
      createdAt: new Date(),
    };

    this.pendingInteractions.set(interaction.id, interaction);
    try {
      await interaction.deferReply();
    } catch (error) {
      this.pendingInteractions.delete(interaction.id);
      throw error;
    }

    try {
      await Promise.all(this.messageHandlers.map((handler) => handler(imMsg)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply(`❌ ${message}`);
      this.pendingInteractions.delete(interaction.id);
    }
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
    const content = text.trim().slice(0, 2000);

    if (target.replyToMessageId) {
      const interaction = this.pendingInteractions.get(target.replyToMessageId);
      if (interaction) {
        this.pendingInteractions.delete(target.replyToMessageId);
        const msg = await interaction.editReply({ content });
        return this.toRef(target, msg.id);
      }
    }

    const channel = await this.resolveChannel(target);
    const options: { content: string; reply?: { messageReference: string } } = {
      content,
    };
    if (target.replyToMessageId) {
      options.reply = { messageReference: target.replyToMessageId };
    }
    const msg = await this.sendWithFallback(channel, options);
    return this.toRef(target, msg.id);
  }

  async editText(ref: IMMessageRef, text: string): Promise<void> {
    const channel = await this.resolveChannel(ref);
    const message = await channel.messages.fetch(ref.messageId);
    await message.edit(text.trim().slice(0, 2000));
  }

  async sendEmbed(target: IMTarget, embed: IMEmbed): Promise<IMMessageRef> {
    const channel = await this.resolveChannel(target);
    const builder = this.buildEmbed(embed);
    const options: { embeds: [EmbedBuilder]; reply?: { messageReference: string } } = {
      embeds: [builder],
    };
    if (target.replyToMessageId) {
      options.reply = { messageReference: target.replyToMessageId };
    }
    const msg = await this.sendWithFallback(channel, options);
    return this.toRef(target, msg.id);
  }

  private async sendWithFallback(
    channel: TextChannel | ThreadChannel,
    options: { content?: string; embeds?: [EmbedBuilder]; reply?: { messageReference: string } }
  ): Promise<{ id: string }> {
    try {
      return await channel.send(options);
    } catch (error) {
      const shouldFallback = options.reply && error instanceof Error;
      if (shouldFallback) {
        const { reply: _reply, ...fallbackOptions } = options;
        return await channel.send(fallbackOptions);
      }
      throw error;
    }
  }

  async editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void> {
    const channel = await this.resolveChannel(ref);
    const message = await channel.messages.fetch(ref.messageId);
    const builder = this.buildEmbed(embed);
    await message.edit({ embeds: [builder] });
  }

  async sendTyping(target: IMTarget): Promise<void> {
    const channel = await this.resolveChannel(target);
    await channel.sendTyping();
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    switch (event.type) {
      case 'text': {
        const trimmed = event.text.trim();
        if (!trimmed) {
          break;
        }
        // After a tool round, start a new message for the summary instead of
        // editing the pre-tool text.
        if (!state.replyMessageRef || state.hasToolCall) {
          state.replyMessageRef = await this.sendText(target, trimmed);
          state.lastTextEditAt = Date.now();
          state.pendingText = undefined;
          state.hasToolCall = false;
          break;
        }

        state.pendingText = trimmed;
        const now = Date.now();
        if (!state.lastTextEditAt || now - state.lastTextEditAt >= this.editDebounceMs) {
          await this.editText(state.replyMessageRef, trimmed);
          state.lastTextEditAt = now;
          state.pendingText = undefined;
        }
        break;
      }
      case 'tool_call': {
        this.toolNames.set(event.toolId, event.toolName);
        const params = this.formatToolInput(event.input);
        const displayName = event.toolName === 'unknown' ? '工具调用' : event.toolName;
        await this.sendText(target, `🔧 ${displayName}\n${params}`);
        state.hasToolCall = true;
        break;
      }
      case 'tool_result': {
        const toolName = this.toolNames.get(event.toolId) ?? event.toolId;
        const displayName = toolName === 'unknown' ? '原始输出' : `${toolName} ✅`;
        const output = event.output.slice(0, 1800);
        await this.sendText(target, `🔧 ${displayName}\n\`\`\`text\n${output}\n\`\`\``);
        break;
      }
      case 'error': {
        await this.sendText(target, `❌ ${event.message}`);
        break;
      }
      case 'thinking': {
        const delta = event.delta ?? event.text;
        if (!delta) break;
        state.thinkingText = state.thinkingText ? `${state.thinkingText}${delta}` : delta;
        const content = `💭 ${state.thinkingText}`.slice(0, 2000);
        if (!state.thinkingMessageRef) {
          state.thinkingMessageRef = await this.sendText(target, content);
        } else {
          await this.editText(state.thinkingMessageRef, content);
        }
        break;
      }
      case 'complete': {
        if (state.replyMessageRef && state.pendingText !== undefined) {
          await this.editText(state.replyMessageRef, state.pendingText);
          state.pendingText = undefined;
        }
        break;
      }
      case 'session_init':
      case 'usage':
        break;
    }
    return state;
  }

  private async resolveChannel(target: IMTarget): Promise<TextChannel | ThreadChannel> {
    const channel = await this.client.channels.fetch(target.threadId ?? target.channelId);
    if (!channel || (!channel.isTextBased() && !channel.isThread())) {
      throw new Error(`Channel not found: ${target.threadId ?? target.channelId}`);
    }
    return channel as TextChannel | ThreadChannel;
  }

  private toRef(target: IMTarget, messageId: string): IMMessageRef {
    return {
      provider: this.name,
      channelId: target.channelId,
      threadId: target.threadId,
      messageId,
    };
  }

  private formatToolInput(input: unknown): string {
    if (input === undefined || input === null) {
      return '';
    }
    if (typeof input !== 'object') {
      return String(input);
    }
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) {
      return '';
    }
    return '```json\n' + JSON.stringify(input, null, 2).slice(0, 1500) + '\n```';
  }

  private buildWorkspaceGuide(): string {
    return [
      '欢迎来到新的 workdir！',
      '- 绑定项目目录：`/workdir <path>`',
      '- 在当前频道直接发消息，即与主 Session 对话',
      '- 需要独立上下文时，右键消息 → 创建 Thread',
      '- 查看可用命令：`/help`',
    ].join('\n');
  }

  private buildEmbed(embed: IMEmbed): EmbedBuilder {
    const builder = new EmbedBuilder();
    if (embed.title) builder.setTitle(embed.title);
    if (embed.description) builder.setDescription(embed.description);
    if (embed.color) builder.setColor(embed.color);
    if (embed.fields) builder.addFields(...embed.fields);
    if (embed.footer) builder.setFooter({ text: embed.footer.text });
    return builder;
  }
}
