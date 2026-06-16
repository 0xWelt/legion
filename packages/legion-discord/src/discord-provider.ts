import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type MessageCreateOptions,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type {
  APIContainerComponent,
  APIMessageTopLevelComponent,
  APITextDisplayComponent,
} from 'discord-api-types/v10';
import { buildCommandContent, buildSlashCommands } from './discord-slash-commands.js';
import type { DiscordProviderOptions } from './config.js';
import { applyAgentEvent, createAccumulatedOutput } from 'legion-api';
import type {
  AgentEvent,
  IMCommandDefinition,
  IMEmbed,
  IMMessage,
  IMMessageRef,
  IMProvider,
  IMTarget,
  IMThread,
  OutputSegment,
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
  private readonly typingIntervals = new Map<string, NodeJS.Timeout>();
  private readonly MAX_CONTENT_CHARS_PER_MESSAGE = 4000;
  private readonly MAX_COMPONENTS_PER_CONTAINER = 10;
  private readonly MAX_TOOL_RESULT_OUTPUT_CHARS = 950;

  constructor(private readonly options: DiscordProviderOptions) {
    this.editDebounceMs = options.editDebounceMs ?? 1000;
    console.log(`[DiscordProvider] editDebounceMs=${this.editDebounceMs}`);
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
    await message.edit(text.trim());
  }

  private textEditLocks = new WeakMap<RenderState, boolean>();

  private startTextEditLoop(target: IMTarget, state: RenderState): void {
    if (state.textEditTimer) {
      return;
    }
    state.textEditTimer = setInterval(async () => {
      if (this.textEditLocks.get(state)) {
        return;
      }
      this.textEditLocks.set(state, true);
      try {
        await this.flushBuffer(target, state);
      } catch (err) {
        console.error('Failed to render Discord batch', err);
      } finally {
        this.textEditLocks.set(state, false);
      }
    }, this.editDebounceMs);
  }

  private stopTextEditLoop(state: RenderState): void {
    if (state.textEditTimer) {
      clearInterval(state.textEditTimer);
      state.textEditTimer = undefined;
    }
  }

  private async flushBuffer(target: IMTarget, state: RenderState): Promise<void> {
    if (!state.accumulatedOutput || state.accumulatedOutput.segments.length === 0) {
      return;
    }
    const pages = this.buildPages(state.accumulatedOutput.segments);
    if (pages.length === 0) {
      return;
    }

    state.replyMessageRefs ??= [];
    const refs = state.replyMessageRefs;

    console.log(`[DiscordProvider] flush pages=${pages.length} existingRefs=${refs.length}`);

    for (let i = 0; i < pages.length; i++) {
      const components = pages[i];
      if (i < refs.length) {
        await this.editComponents(refs[i], components);
      } else {
        const shouldReply = refs.length === 0 && i === 0;
        const ref = await this.sendComponents(target, components, shouldReply);
        refs.push(ref);
      }
    }

    while (refs.length > pages.length) {
      const ref = refs.pop();
      if (ref) {
        try {
          await this.deleteMessage(ref);
        } catch (err) {
          console.error('[DiscordProvider] failed to delete extra page', err);
        }
      }
    }
  }

  private buildPages(segments: OutputSegment[]): APIMessageTopLevelComponent[][] {
    const units = this.buildUnits(segments);
    if (units.length === 0) {
      return [];
    }

    const items = this.buildTopLevelItems(units);
    return this.groupItemsIntoPages(items);
  }

  private buildUnits(
    segments: OutputSegment[]
  ): Array<{ content: string; segmentType: OutputSegment['type'] }> {
    const units: Array<{ content: string; segmentType: OutputSegment['type'] }> = [];
    for (const seg of segments) {
      const content = this.formatSegment(seg);
      if (content.length === 0) {
        continue;
      }
      if (seg.type === 'tool_call' && content.length > this.MAX_CONTENT_CHARS_PER_MESSAGE) {
        units.push(...this.splitToolCallContent(content));
        continue;
      }
      if (content.length <= this.MAX_CONTENT_CHARS_PER_MESSAGE) {
        units.push({ content, segmentType: seg.type });
      } else {
        for (let i = 0; i < content.length; i += this.MAX_CONTENT_CHARS_PER_MESSAGE) {
          units.push({
            content: content.slice(i, i + this.MAX_CONTENT_CHARS_PER_MESSAGE),
            segmentType: seg.type,
          });
        }
      }
    }
    return units;
  }

  private splitToolCallContent(
    content: string
  ): Array<{ content: string; segmentType: 'tool_call' }> {
    const maxChunk = this.MAX_CONTENT_CHARS_PER_MESSAGE;
    const firstNewline = content.indexOf('\n');
    if (firstNewline === -1) {
      const result: Array<{ content: string; segmentType: 'tool_call' }> = [];
      for (let i = 0; i < content.length; i += this.MAX_CONTENT_CHARS_PER_MESSAGE) {
        result.push({
          content: content.slice(i, i + this.MAX_CONTENT_CHARS_PER_MESSAGE),
          segmentType: 'tool_call',
        });
      }
      return result;
    }

    const header = content.slice(0, firstNewline);
    const body = content.slice(firstNewline + 1);
    const bodyLines = body.split('\n');
    const opener = bodyLines[0];
    const closer = bodyLines[bodyLines.length - 1];

    if (opener?.startsWith('```') && closer === '```' && bodyLines.length >= 2) {
      const inner = bodyLines.slice(1, -1).join('\n');
      const chunkInnerMax = maxChunk - opener.length - closer.length - 2; // newlines
      const result: Array<{ content: string; segmentType: 'tool_call' }> = [
        { content: header, segmentType: 'tool_call' },
      ];
      for (let i = 0; i < inner.length; i += chunkInnerMax) {
        const chunk = inner.slice(i, i + chunkInnerMax);
        result.push({
          content: `${opener}\n${chunk}\n${closer}`,
          segmentType: 'tool_call',
        });
      }
      return result;
    }

    const result: Array<{ content: string; segmentType: 'tool_call' }> = [
      { content: header, segmentType: 'tool_call' },
    ];
    for (let i = 0; i < body.length; i += this.MAX_CONTENT_CHARS_PER_MESSAGE) {
      result.push({
        content: body.slice(i, i + this.MAX_CONTENT_CHARS_PER_MESSAGE),
        segmentType: 'tool_call',
      });
    }
    return result;
  }

  private buildTopLevelItems(
    units: Array<{ content: string; segmentType: OutputSegment['type'] }>
  ): Array<{ component: APIMessageTopLevelComponent; length: number }> {
    const items: Array<{ component: APIMessageTopLevelComponent; length: number }> = [];
    let currentContainer: { component: APIContainerComponent; length: number } | null = null;

    const flushContainer = () => {
      if (currentContainer) {
        items.push(currentContainer);
        currentContainer = null;
      }
    };

    for (const unit of units) {
      if (unit.segmentType === 'text') {
        flushContainer();
        items.push({
          component: this.createTextDisplay(unit.content),
          length: unit.content.length,
        });
        continue;
      }

      const accentColor = this.segmentAccentColor(unit.segmentType);
      const needsNewContainer =
        !currentContainer ||
        currentContainer.component.components.length >= this.MAX_COMPONENTS_PER_CONTAINER ||
        currentContainer.length + unit.content.length > this.MAX_CONTENT_CHARS_PER_MESSAGE ||
        currentContainer.component.accent_color !== accentColor;

      if (needsNewContainer) {
        flushContainer();
        currentContainer = {
          component: this.createContainer([], accentColor),
          length: 0,
        };
      }
      currentContainer!.component.components.push(this.createTextDisplay(unit.content));
      currentContainer!.length += unit.content.length;
    }

    flushContainer();
    return items;
  }

  private groupItemsIntoPages(
    items: Array<{ component: APIMessageTopLevelComponent; length: number }>
  ): APIMessageTopLevelComponent[][] {
    const pages: APIMessageTopLevelComponent[][] = [];
    let currentPage: APIMessageTopLevelComponent[] = [];
    let currentLength = 0;

    for (const { component, length } of items) {
      if (
        currentPage.length >= this.MAX_COMPONENTS_PER_CONTAINER ||
        (currentPage.length > 0 && currentLength + length > this.MAX_CONTENT_CHARS_PER_MESSAGE)
      ) {
        pages.push(currentPage);
        currentPage = [];
        currentLength = 0;
      }
      currentPage.push(component);
      currentLength += length;
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  }

  private segmentAccentColor(segmentType: Exclude<OutputSegment['type'], 'text'>): number {
    switch (segmentType) {
      case 'thinking':
        return 0x3498db;
      case 'tool_call':
        return 0xf39c12;
      case 'tool_result':
        return 0x2ecc71;
      case 'error':
        return 0xff0000;
    }
  }

  private createTextDisplay(content: string): APITextDisplayComponent {
    return { type: 10 as const, content };
  }

  private createContainer(
    components: APITextDisplayComponent[],
    accentColor: number
  ): APIContainerComponent {
    return { type: 17 as const, components, accent_color: accentColor };
  }

  private formatSegment(seg: OutputSegment): string {
    switch (seg.type) {
      case 'text':
        return seg.content;
      case 'thinking':
        return `💭 ${seg.content}`;
      case 'tool_call':
        return `🔧 ${seg.toolName}\n${this.formatToolInput(seg.input)}`;
      case 'tool_result': {
        const toolName = this.toolNames.get(seg.toolId) ?? seg.toolId;
        const output = this.truncateTail(seg.output, this.MAX_TOOL_RESULT_OUTPUT_CHARS);
        return `✅ ${toolName}\n\`\`\`text\n${output}\n\`\`\``;
      }
      case 'error':
        return `❌ ${seg.message}`;
    }
  }

  private async sendComponents(
    target: IMTarget,
    components: APIMessageTopLevelComponent[],
    reply: boolean
  ): Promise<IMMessageRef> {
    const channel = await this.resolveChannel(target);
    const options: Record<string, unknown> = {
      components,
      flags: 1 << 15, // MessageFlags.IsComponentsV2
    };
    if (reply && target.replyToMessageId) {
      options.reply = { messageReference: target.replyToMessageId };
    }
    const msg = await this.sendWithFallback(channel, options);
    return this.toRef(target, msg.id);
  }

  private async sendWithFallback(
    channel: TextChannel | ThreadChannel,
    options: Record<string, unknown>
  ): Promise<{ id: string }> {
    try {
      return await channel.send(options as MessageCreateOptions);
    } catch (error) {
      const shouldFallback = options.reply && error instanceof Error;
      if (shouldFallback) {
        const { reply: _reply, ...fallbackOptions } = options;
        return await channel.send(fallbackOptions as MessageCreateOptions);
      }
      throw error;
    }
  }

  private async editComponents(
    ref: IMMessageRef,
    components: APIMessageTopLevelComponent[]
  ): Promise<void> {
    const channel = await this.resolveChannel(ref);
    const message = await channel.messages.fetch(ref.messageId);
    await message.edit({
      components,
      flags: 1 << 15, // MessageFlags.IsComponentsV2
    });
  }

  private async deleteMessage(ref: IMMessageRef): Promise<void> {
    const channel = await this.resolveChannel(ref);
    const message = await channel.messages.fetch(ref.messageId);
    await message.delete();
  }

  private truncateTail(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    const prefix = '...';
    return prefix + text.slice(text.length - (maxLength - prefix.length));
  }

  async sendTyping(target: IMTarget): Promise<void> {
    const key = this.targetKey(target);
    if (this.typingIntervals.has(key)) {
      return;
    }

    const channel = await this.resolveChannel(target);
    await channel.sendTyping();

    const interval = setInterval(async () => {
      try {
        await channel.sendTyping();
      } catch (err) {
        console.error('[DiscordProvider] sendTyping failed', err);
        this.stopTyping(target);
      }
    }, 8000);

    this.typingIntervals.set(key, interval);
  }

  private stopTyping(target: IMTarget): void {
    const key = this.targetKey(target);
    const interval = this.typingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(key);
    }
  }

  private targetKey(target: IMTarget): string {
    return target.threadId ?? target.channelId;
  }

  async renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState> {
    switch (event.type) {
      case 'text':
      case 'thinking':
      case 'tool_call':
      case 'tool_call_delta':
      case 'tool_result':
      case 'error': {
        state.accumulatedOutput ??= createAccumulatedOutput();
        applyAgentEvent(state.accumulatedOutput, event);
        if (event.type === 'tool_call' || event.type === 'tool_call_delta') {
          this.toolNames.set(event.toolId, event.toolName);
        }
        if (this.editDebounceMs <= 0) {
          await this.flushBuffer(target, state);
        } else {
          this.startTextEditLoop(target, state);
        }
        break;
      }
      case 'complete': {
        this.stopTextEditLoop(state);
        await this.flushBuffer(target, state);
        state.accumulatedOutput = undefined;
        this.stopTyping(target);
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
    if (typeof input === 'string') {
      return '```json\n' + input + '\n```';
    }
    if (typeof input !== 'object') {
      return String(input);
    }
    const entries = Object.entries(input as Record<string, unknown>);
    if (entries.length === 0) {
      return '';
    }
    return '```json\n' + JSON.stringify(input, null, 2) + '\n```';
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

  async editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void> {
    const channel = await this.resolveChannel(ref);
    const message = await channel.messages.fetch(ref.messageId);
    const builder = this.buildEmbed(embed);
    await message.edit({ embeds: [builder] });
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
