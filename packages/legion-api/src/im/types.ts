import type { AgentEvent, Session } from '../core/types.js';
import type { AccumulatedOutput } from './event-accumulator.js';

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

export interface IMProviderStatus {
  configured: boolean;
  connected?: boolean;
  summary: string;
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

  /**
   * Optional hook to push a session state update to the IM client. Used by the
   * Web UI so that the status bar reflects commands such as `/workdir` or
   * `/agent` without requiring a page refresh.
   */
  updateSession?(target: IMTarget, session: Session): Promise<void>;

  /**
   * Optional provider-specific status shown in the Web UI status page. Each
   * provider defines what "configured" means for itself.
   */
  getStatus?(): IMProviderStatus;

  /**
   * Optional real connectivity check. Should verify that the provider's
   * credentials actually work (e.g. by calling the platform API).
   */
  checkConnection?(): Promise<boolean>;

  onMessage(handler: (msg: IMMessage) => void | Promise<void>): void;

  /**
   * Optional hook for providers that can spawn child IM sessions (e.g. Discord
   * threads). When a child session is created, the provider emits an event so
   * the core can fork the parent Agent session's settings into the child.
   */
  onSessionFork?(handler: (event: IMForkEvent) => void | Promise<void>): void;
}

export interface IMForkEvent {
  provider: string;
  parentSessionId: string;
  childSessionId: string;
  name?: string;
}

export interface IMTarget {
  sessionId: string;
  provider: string;
  replyToMessageId?: string;
}

export interface IMMessageRef {
  provider: string;
  sessionId: string;
  messageId: string;
}

export interface IMMessage {
  id: string;
  provider: string;
  sessionId: string;
  authorId: string;
  authorName: string;
  content: string;
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
  /**
   * Multiple message refs for providers that paginate a single agent response
   * across several messages (e.g. Discord Components V2 splitting).
   */
  replyMessageRefs?: IMMessageRef[];
  toolMessageRefs: Map<string, IMMessageRef>;
  textEditTimer?: NodeJS.Timeout;
  statusPrefix?: string;
  /**
   * Unified accumulated output for providers that batch streaming events into
   * a single message (e.g. Discord batch mode).
   */
  accumulatedOutput?: AccumulatedOutput;
}
