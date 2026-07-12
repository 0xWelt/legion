import { ref, onMounted, onUnmounted } from 'vue';

type EventName =
  | 'text'
  | 'edit-text'
  | 'embed'
  | 'edit-embed'
  | 'typing'
  | 'agent-event'
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

  function send(payload: Record<string, unknown>) {
    ws.value?.send(JSON.stringify(payload));
  }

  onMounted(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
    );
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
