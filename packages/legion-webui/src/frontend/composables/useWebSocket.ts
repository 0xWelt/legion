import { ref, onMounted, onUnmounted } from 'vue';

type EventName =
  | 'text'
  | 'edit-text'
  | 'embed'
  | 'edit-embed'
  | 'typing'
  | 'agent-event'
  | 'session-update'
  | 'commands';
type Handler = (payload: unknown) => void;

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null);
  const handlers = new Map<EventName, Handler[]>();

  function on(event: EventName, handler: Handler) {
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event)!.push(handler);
  }

  function emit(event: EventName, payload: unknown) {
    for (const h of handlers.get(event) ?? []) {
      h(payload);
    }
  }

  const pending = ref<Record<string, unknown>[]>([]);

  function flush() {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return;
    while (pending.value.length > 0) {
      const msg = pending.value.shift();
      if (msg) ws.value.send(JSON.stringify(msg));
    }
  }

  function send(payload: Record<string, unknown>) {
    pending.value.push(payload);
    flush();
  }

  onMounted(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
    );
    socket.onopen = () => flush();
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: EventName; [key: string]: unknown };
        emit(msg.type, msg);
      } catch {
        // ignore
      }
    };
    ws.value = socket;
  });

  onUnmounted(() => {
    ws.value?.close();
  });

  return { on, send };
}
