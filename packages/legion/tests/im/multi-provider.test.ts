import { describe, expect, it, vi } from 'vitest';
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
import { MultiIMProvider } from '../../src/im/multi-provider.js';

/* eslint-disable @typescript-eslint/unbound-method */

function fakeProvider(name: string): IMProvider {
  let messageHandler: ((msg: IMMessage) => void | Promise<void>) | undefined;

  return {
    name,
    start: vi.fn().mockResolvedValue(undefined),
    registerCommands: vi.fn(),
    onMessage: vi.fn((handler) => {
      messageHandler = handler;
    }),
    sendText: vi.fn(
      async (target: IMTarget, text: string): Promise<IMMessageRef> => ({
        provider: name,
        sessionId: target.sessionId,
        messageId: `${name}-${text}`,
      })
    ),
    editText: vi.fn().mockResolvedValue(undefined),
    sendEmbed: vi.fn().mockResolvedValue({ provider: name, sessionId: 'c', messageId: 'm' }),
    editEmbed: vi.fn().mockResolvedValue(undefined),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    renderEvent: vi.fn().mockImplementation((_target, _event, state) => Promise.resolve(state)),
    _emitMessage(msg: IMMessage) {
      void messageHandler?.(msg);
    },
  } as unknown as IMProvider & {
    _emitMessage: (msg: IMMessage) => void;
  };
}

describe('MultiIMProvider', () => {
  it('starts all providers and broadcasts commands', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    const commands: IMCommandDefinition[] = [{ name: 'agent', description: 'Agent command' }];
    multi.registerCommands(commands);

    await multi.start();

    expect(a.start).toHaveBeenCalledOnce();
    expect(b.start).toHaveBeenCalledOnce();
    expect(a.registerCommands).toHaveBeenCalledWith(commands);
    expect(b.registerCommands).toHaveBeenCalledWith(commands);
  });

  it('routes replies to the provider that received the original message', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    const received: IMMessage[] = [];
    multi.onMessage((msg) => {
      received.push(msg);
    });
    await multi.start();

    const msg: IMMessage = {
      id: 'msg-1',
      provider: 'b',
      sessionId: 's1',
      authorId: 'u',
      authorName: 'User',
      content: 'hello',
      createdAt: new Date(),
    };

    (b as unknown as { _emitMessage: (msg: IMMessage) => void })._emitMessage(msg);

    const target: IMTarget = { sessionId: 's1', provider: 'b', replyToMessageId: 'msg-1' };
    await multi.sendText(target, 'reply');

    expect(b.sendText).toHaveBeenCalledWith(target, 'reply');
    expect(a.sendText).not.toHaveBeenCalled();
  });

  it('routes by target.provider when message id is unknown', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    await multi.start();

    const target: IMTarget = { sessionId: 's2', provider: 'a' };
    await multi.sendText(target, 'reply');

    expect(a.sendText).toHaveBeenCalledWith(target, 'reply');
    expect(b.sendText).not.toHaveBeenCalled();
  });

  it('routes editText by ref.provider', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    const ref: IMMessageRef = { provider: 'a', sessionId: 'c', messageId: 'm' };
    await multi.editText(ref, 'updated');

    expect(a.editText).toHaveBeenCalledWith(ref, 'updated');
    expect(b.editText).not.toHaveBeenCalled();
  });

  it('forwards renderEvent to the source provider', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    await multi.start();

    const msg: IMMessage = {
      id: 'msg-2',
      provider: 'b',
      sessionId: 's1',
      authorId: 'u',
      authorName: 'User',
      content: 'hi',
      createdAt: new Date(),
    };
    (b as unknown as { _emitMessage: (msg: IMMessage) => void })._emitMessage(msg);

    const target: IMTarget = { sessionId: 's1', provider: 'b' };
    const event: AgentEvent = { type: 'text', text: 'hello' };
    const state: RenderState = { toolMessageRefs: new Map() };

    await multi.renderEvent(target, event, state);

    expect(b.renderEvent).toHaveBeenCalledWith(target, event, state);
    expect(a.renderEvent).not.toHaveBeenCalled();
  });

  it('falls back to the first provider when target source is unknown', async () => {
    const a = fakeProvider('a');
    const b = fakeProvider('b');
    const multi = new MultiIMProvider([a, b]);

    await multi.start();

    const target: IMTarget = { sessionId: 's3', provider: 'unknown' };
    const embed: IMEmbed = { title: 'T' };
    await multi.sendEmbed(target, embed);

    expect(a.sendEmbed).toHaveBeenCalledWith(target, embed);
    expect(b.sendEmbed).not.toHaveBeenCalled();
  });
});
