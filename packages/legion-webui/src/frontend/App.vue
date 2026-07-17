<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ChatPane from './components/ChatPane.vue';
import SettingsView from './views/SettingsView.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import type { Session, ChatMessage, OutputSegment, LegionConfig } from './types.js';

type AgentEvent =
  | { type: 'text'; text?: string; delta?: string }
  | { type: 'thinking'; text?: string; delta?: string }
  | { type: 'tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'tool_call_delta'; toolId: string; toolName: string; partialInput: string }
  | { type: 'tool_result'; toolId: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'complete' }
  | { type: 'session_init' }
  | { type: 'usage' };

const view = ref<'chat' | 'settings'>('chat');
const activeSession = ref<string | null>(null);
const sessions = ref<Session[]>([]);
const messages = ref<ChatMessage[]>([]);
const sessionOutputs = ref<Record<string, OutputSegment[]>>({});
const config = ref<LegionConfig>({});

const webuiSessions = computed(() => sessions.value.filter((s) => s.provider === 'webui'));

const ws = useWebSocket();

function renderSegment(seg: OutputSegment): string {
  switch (seg.type) {
    case 'text':
      return seg.content ?? '';
    case 'thinking':
      return `> 💭 ${seg.content ?? ''}`;
    case 'tool_call':
      return `### 🔧 Tool call: \`${seg.toolName ?? 'unknown'}\`\n\`\`\`json\n${JSON.stringify(seg.input ?? {}, null, 2)}\n\`\`\``;
    case 'tool_result':
      return `### ✅ Tool result\n\`\`\`\n${seg.output ?? ''}\n\`\`\``;
    case 'error':
      return `❌ **Error:** ${seg.message ?? ''}`;
    default:
      return '';
  }
}

function renderOutput(segments: OutputSegment[]): string {
  return segments.map(renderSegment).filter(Boolean).join('\n\n');
}

function applyAgentEvent(segments: OutputSegment[], event: AgentEvent): void {
  switch (event.type) {
    case 'text': {
      if (event.delta !== undefined) {
        if (!event.delta) break;
        const last = segments[segments.length - 1];
        if (last?.type === 'text') {
          last.content = (last.content ?? '') + event.delta;
        } else {
          segments.push({ type: 'text', content: event.delta });
        }
      } else if (event.text?.trim()) {
        const last = segments[segments.length - 1];
        if (last?.type === 'text') {
          last.content = event.text.trim();
        } else {
          segments.push({ type: 'text', content: event.text.trim() });
        }
      }
      break;
    }
    case 'thinking': {
      if (event.delta !== undefined) {
        if (!event.delta) break;
        const last = segments[segments.length - 1];
        if (last?.type === 'thinking') {
          last.content = (last.content ?? '') + event.delta;
        } else {
          segments.push({ type: 'thinking', content: event.delta });
        }
      } else if (event.text?.trim()) {
        const last = segments[segments.length - 1];
        if (last?.type === 'thinking') {
          last.content = event.text.trim();
        } else {
          segments.push({ type: 'thinking', content: event.text.trim() });
        }
      }
      break;
    }
    case 'tool_call': {
      const last = segments[segments.length - 1];
      if (last?.type === 'tool_call' && last.toolName === event.toolName) {
        last.input = event.input;
      } else {
        segments.push({ type: 'tool_call', toolName: event.toolName, input: event.input });
      }
      break;
    }
    case 'tool_call_delta': {
      const last = segments[segments.length - 1];
      if (last?.type === 'tool_call' && last.toolName === event.toolName) {
        last.input = event.partialInput;
      } else {
        segments.push({ type: 'tool_call', toolName: event.toolName, input: event.partialInput });
      }
      break;
    }
    case 'tool_result': {
      segments.push({ type: 'tool_result', output: event.output });
      break;
    }
    case 'error': {
      segments.push({ type: 'error', message: event.message });
      break;
    }
    case 'complete':
    case 'session_init':
    case 'usage':
      break;
  }
}

function upsertMessage(
  id: string,
  role: ChatMessage['role'],
  content: string,
  sessionId: string,
  segments?: OutputSegment[]
) {
  const existing = messages.value.find((m) => m.id === id);
  if (existing) {
    existing.content = content;
    if (segments) existing.segments = segments;
  } else {
    messages.value.push({ id, role, content, sessionId, segments });
  }
}

onMounted(async () => {
  const [stateRes, configRes] = await Promise.all([fetch('/api/state'), fetch('/api/config')]);
  if (stateRes.ok) {
    const data = (await stateRes.json()) as { sessions: Session[] };
    sessions.value = data.sessions ?? [];
  }
  if (configRes.ok) {
    const data = (await configRes.json()) as { config: LegionConfig };
    config.value = data.config ?? {};
  }

  ws.on('text', (payload: { target: { sessionId: string }; text: string; messageId: string }) => {
    upsertMessage(payload.messageId, 'assistant', payload.text, payload.target.sessionId);
  });

  ws.on('edit-text', (payload: { ref: { messageId: string }; text: string }) => {
    const existing = messages.value.find((m) => m.id === payload.ref.messageId);
    if (existing) {
      existing.content = payload.text;
    }
  });

  ws.on('agent-event', (payload: { target: { sessionId: string }; event: AgentEvent }) => {
    const key = payload.target.sessionId;
    const segments = sessionOutputs.value[key] ?? [];

    if (payload.event.type === 'text' && !payload.event.delta && payload.event.text?.trim()) {
      // Simulate streaming for complete text events by revealing the new text
      // gradually. Kimi CLI's stream-json emits cumulative text, so we compute
      // the delta and reveal it in small chunks.
      const newText = payload.event.text.trim();
      const last = segments[segments.length - 1];
      if (last?.type === 'text') {
        streamTextSegment(key, segments, last, newText);
      } else {
        const seg: OutputSegment = { type: 'text', content: '' };
        segments.push(seg);
        streamTextSegment(key, segments, seg, newText);
      }
      sessionOutputs.value[key] = segments;
      return;
    }

    applyAgentEvent(segments, payload.event);
    sessionOutputs.value[key] = segments;

    const content = renderOutput(segments);
    if (!content) return;

    const messageId = `agent-${key}`;
    upsertMessage(messageId, 'assistant', content, payload.target.sessionId, segments);
  });

  ws.on('session-update', (payload: { target: { sessionId: string }; session: Session }) => {
    const idx = sessions.value.findIndex((s) => s.id === payload.target.sessionId);
    if (idx >= 0) {
      sessions.value[idx] = { ...sessions.value[idx], ...payload.session };
    }
  });
});

const textRevealTimers = new Map<string, ReturnType<typeof setInterval>>();

function streamTextSegment(
  sessionId: string,
  segments: OutputSegment[],
  seg: OutputSegment,
  fullText: string
) {
  const timer = textRevealTimers.get(sessionId);
  if (timer) clearInterval(timer);

  const current = seg.content ?? '';
  if (fullText === current) return;

  // If the new text is cumulative, reveal only the delta; otherwise replace.
  const target = fullText.startsWith(current) ? current + fullText.slice(current.length) : fullText;
  const total = target.length;
  let index = current.length;
  const chunkSize = Math.max(1, Math.ceil((total - index) / 60));

  const newTimer = setInterval(() => {
    index = Math.min(total, index + chunkSize);
    seg.content = target.slice(0, index);

    const content = renderOutput(segments);
    const messageId = `agent-${sessionId}`;
    upsertMessage(messageId, 'assistant', content, sessionId, segments);

    if (index >= total) {
      clearInterval(newTimer);
      textRevealTimers.delete(sessionId);
    }
  }, 20);

  textRevealTimers.set(sessionId, newTimer);
}

function createSession() {
  const sessionId = `webui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessions.value.push({
    id: sessionId,
    provider: 'webui',
    name: 'New session',
    path: '',
    agent: config.value.defaultAgent ?? 'kimi-code',
    status: 'idle',
  });
  activeSession.value = sessionId;
  view.value = 'chat';
}

function send(content: string) {
  if (!activeSession.value) return;
  ws.send({
    type: 'message',
    sessionId: activeSession.value,
    content,
  });
  messages.value.push({
    id: `${Date.now()}`,
    role: 'user',
    content,
    sessionId: activeSession.value,
  });
}

function selectSession(sessionId: string) {
  activeSession.value = sessionId;
  view.value = 'chat';
}
</script>

<template>
  <div class="app-shell">
    <Sidebar
      :sessions="webuiSessions"
      :active-session="activeSession"
      :current-view="view"
      @select-session="selectSession"
      @create-session="createSession"
      @switch-view="view = $event"
    />
    <main class="main">
      <ChatPane
        v-if="view === 'chat'"
        :session="webuiSessions.find((s) => s.id === activeSession)"
        :session-id="activeSession"
        :messages="messages.filter((m) => m.sessionId === activeSession)"
        :config="config"
        @send="send"
      />
      <SettingsView v-else-if="view === 'settings'" />
    </main>
  </div>
</template>

<style>
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0d1117;
  color: #c9d1d9;
}
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
</style>
