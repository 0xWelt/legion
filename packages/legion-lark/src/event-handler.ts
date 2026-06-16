import type { IMMessage } from 'legion-api';
import type { LarkMessageEvent } from './types.js';

export function parseMessageEvent(event: LarkMessageEvent): IMMessage | undefined {
  const message = event.event?.message;
  const sender = event.event?.sender;
  if (!message || !sender) {
    return undefined;
  }

  // Ignore bot's own messages to avoid loops.
  if (sender.sender_type === 'app') {
    return undefined;
  }

  const text = parseTextContent(message.content);
  if (text === undefined) {
    return undefined;
  }

  return {
    id: message.message_id,
    provider: 'lark',
    channelId: message.chat_id,
    threadId: message.thread_id,
    authorId: sender.sender_id.open_id,
    authorName: sender.name ?? sender.sender_id.open_id,
    content: text,
    createdAt: new Date(Number(message.create_time ?? Date.now())),
  };
}

function parseTextContent(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text;
  } catch {
    return content;
  }
}
