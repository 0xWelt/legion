export interface LarkMessageEvent {
  ts: string;
  uuid: string;
  token?: string;
  type?: string;
  app_id: string;
  tenant_key: string;
  create_time?: string;
  event_time?: string;
  event?: {
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          open_id: string;
          union_id?: string;
          user_id?: string;
        };
        name: string;
      }>;
      parent_id?: string;
      thread_id?: string;
      create_time?: string;
      update_time?: string;
    };
    sender: {
      sender_id: {
        open_id: string;
        union_id?: string;
        user_id?: string;
      };
      sender_type: string;
      tenant_key: string;
      name?: string;
    };
  };
}

export interface LarkCard {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
    update_multi?: boolean;
  };
  header?: {
    template?: string;
    title: {
      tag: 'plain_text';
      content: string;
    };
  };
  elements: unknown[];
}

export interface LarkCreateMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id: string;
    chat_id?: string;
    create_time?: string;
    update_time?: string;
  };
}
