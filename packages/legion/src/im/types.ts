import type { AgentEvent } from '../core/types.js';

export interface IMCommandOption {
  name: string;
  description: string;
  required?: boolean;
  choices?: string[];
}

export interface IMCommandDefinition {
  name: string;
  description: string;
  options?: IMCommandOption[];
}

export interface IMProvider {
  name: string;
  start(): Promise<void>;

  registerCommands?(commands: IMCommandDefinition[]): void;
  sendText(target: IMTarget, text: string): Promise<IMMessageRef>;
  editText(ref: IMMessageRef, text: string): Promise<void>;
  sendEmbed(target: IMTarget, embed: IMEmbed): Promise<IMMessageRef>;
  editEmbed(ref: IMMessageRef, embed: IMEmbed): Promise<void>;
  sendTyping(target: IMTarget): Promise<void>;

  renderEvent(target: IMTarget, event: AgentEvent, state: RenderState): Promise<RenderState>;

  onMessage(handler: (msg: IMMessage) => void): void;
  onThreadCreate(handler: (thread: IMThread) => void): void;
  onThreadDelete(handler: (threadId: string) => void): void;
  onThreadArchive(handler: (threadId: string, archived: boolean) => void): void;
}

export interface IMTarget {
  channelId: string;
  threadId?: string;
  replyToMessageId?: string;
}

export interface IMMessageRef {
  provider: string;
  channelId: string;
  threadId?: string;
  messageId: string;
}

export interface IMMessage {
  id: string;
  provider: string;
  channelId: string;
  threadId?: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export interface IMThread {
  id: string;
  provider: string;
  channelId: string;
  name: string;
  createdAt: Date;
}

export interface IMEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: IMEmbedField[];
  footer?: { text: string };
}

export interface IMEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface RenderState {
  replyMessageRef?: IMMessageRef;
  toolMessageRefs: Map<string, IMMessageRef>;
  thinkingMessageRef?: IMMessageRef;
  thinkingText?: string;
  pendingText?: string;
  lastTextEditAt?: number;
  statusPrefix?: string;
  hasToolCall?: boolean;
}
