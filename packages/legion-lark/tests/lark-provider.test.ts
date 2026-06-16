import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LarkProvider } from '../src/lark-provider.js';
import type { AgentEvent, RenderState } from 'legion';
import type { LarkCreateMessageResponse, LarkMessageEvent } from '../src/types.js';
import type * as lark from '@larksuiteoapi/node-sdk';

function createFakeClient() {
  const requests: Array<{ method: string; url: string; data?: unknown; params?: unknown }> = [];
  const request = vi
    .fn()
    .mockImplementation(
      async (config: { method: string; url: string; data?: unknown; params?: unknown }) => {
        requests.push(config);
        const url = config.url;
        if (url.includes('/messages/') && url.endsWith('/reply')) {
          return {
            code: 0,
            msg: 'ok',
            data: { message_id: 'reply-msg-1' },
          } satisfies LarkCreateMessageResponse;
        }
        return {
          code: 0,
          msg: 'ok',
          data: { message_id: 'msg-1' },
        } satisfies LarkCreateMessageResponse;
      }
    );
  return { request, requests };
}

function createProvider(fake: ReturnType<typeof createFakeClient>) {
  return new LarkProvider({
    appId: 'cli_xxx',
    appSecret: 'secret',
    mode: 'long-connection',
    _client: { request: fake.request } as unknown as lark.Client,
  });
}

function createMessageEvent(
  content: string,
  overrides?: Partial<NonNullable<LarkMessageEvent['event']>['message']>
): LarkMessageEvent {
  return {
    ts: '123',
    uuid: 'uuid',
    app_id: 'app',
    tenant_key: 'tenant',
    event: {
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: content }),
        ...overrides,
      },
      sender: {
        sender_id: { open_id: 'ou_1' },
        sender_type: 'user',
        tenant_key: 'tenant',
        name: 'Tester',
      },
    },
  };
}

describe('LarkProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends text messages to chat', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const ref = await provider.sendText({ channelId: 'oc_1' }, 'hello');

    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(fake.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages',
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_1',
        msg_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
    });
    expect(ref).toEqual({ provider: 'lark', channelId: 'oc_1', messageId: 'msg-1' });
  });

  it('replies to a specific message when replyToMessageId is set', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const ref = await provider.sendText(
      { channelId: 'oc_1', replyToMessageId: 'om_user' },
      'reply'
    );

    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(fake.request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_user/reply',
      data: {
        msg_type: 'text',
        content: JSON.stringify({ text: 'reply' }),
      },
    });
    expect(ref.messageId).toBe('reply-msg-1');
  });

  it('edits messages', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    await provider.editText({ provider: 'lark', channelId: 'oc_1', messageId: 'om_1' }, 'updated');

    expect(fake.request).toHaveBeenCalledTimes(1);
    expect(fake.request.mock.calls[0][0]).toMatchObject({
      method: 'PATCH',
      url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_1',
      data: { content: JSON.stringify({ text: 'updated' }) },
    });
  });

  it('parses incoming message events', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const handler = vi.fn();
    provider.onMessage(handler);

    await (
      provider as unknown as { handleMessageEvent: (data: LarkMessageEvent) => Promise<void> }
    ).handleMessageEvent(createMessageEvent('/workdir /tmp/repo'));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'om_1',
        provider: 'lark',
        channelId: 'oc_1',
        authorId: 'ou_1',
        authorName: 'Tester',
        content: '/workdir /tmp/repo',
      })
    );
  });

  it('ignores bot messages', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const handler = vi.fn();
    provider.onMessage(handler);

    const event = createMessageEvent('hello');
    event.event!.sender.sender_type = 'app';

    await (
      provider as unknown as { handleMessageEvent: (data: LarkMessageEvent) => Promise<void> }
    ).handleMessageEvent(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('filters messages by allowedChatIds', async () => {
    const fake = createFakeClient();
    const provider = new LarkProvider({
      appId: 'cli_xxx',
      appSecret: 'secret',
      mode: 'long-connection',
      allowedChatIds: ['oc_2'],
      _client: { request: fake.request } as unknown as lark.Client,
    });

    const handler = vi.fn();
    provider.onMessage(handler);

    await (
      provider as unknown as { handleMessageEvent: (data: LarkMessageEvent) => Promise<void> }
    ).handleMessageEvent(createMessageEvent('hello'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('renders agent events as a single interactive card', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const state: RenderState = { toolMessageRefs: new Map() };

    const textEvent: AgentEvent = { type: 'text', text: 'first' };
    await provider.renderEvent({ channelId: 'oc_1' }, textEvent, state);

    expect(fake.request).toHaveBeenCalledTimes(1);
    const firstCall = fake.request.mock.calls[0][0] as {
      data: { msg_type: string; content: string };
    };
    expect(firstCall.data.msg_type).toBe('interactive');
    const firstCard = JSON.parse(firstCall.data.content);
    expect(firstCard.elements[0].text.content).toBe('first');
    expect(state.replyMessageRef).toBeDefined();

    const secondEvent: AgentEvent = { type: 'text', text: 'second' };
    await provider.renderEvent({ channelId: 'oc_1' }, secondEvent, state);

    expect(fake.request).toHaveBeenCalledTimes(2);
    const secondCall = fake.request.mock.calls[1][0] as {
      method: string;
      url: string;
      data: { content: string };
    };
    expect(secondCall.method).toBe('PATCH');
    expect(secondCall.url).toBe('https://open.feishu.cn/open-apis/im/v1/messages/msg-1');
    const secondCard = JSON.parse(secondCall.data.content);
    expect(secondCard.elements[0].text.content).toBe('second');
  });

  it('puts tool calls and results into collapsible panels', async () => {
    const fake = createFakeClient();
    const provider = createProvider(fake);

    const state: RenderState = { toolMessageRefs: new Map() };

    await provider.renderEvent(
      { channelId: 'oc_1' },
      { type: 'tool_call', toolId: 't1', toolName: 'read_file', input: { path: '/tmp/a' } },
      state
    );

    const call = fake.request.mock.calls[0][0] as { data: { content: string } };
    const card = JSON.parse(call.data.content);
    const panel = card.elements.find(
      (el: { tag: string; header: { content: string } }) => el.tag === 'collapsible_panel'
    );
    expect(panel).toBeDefined();
    expect(panel.header.content).toBe('🔧 工具调用');
  });
});
