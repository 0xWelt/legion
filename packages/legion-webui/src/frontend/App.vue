<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ChatPane from './components/ChatPane.vue';
import StatusView from './views/StatusView.vue';
import SettingsView from './views/SettingsView.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import type { Session, ChatMessage } from './types.js';

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

interface OutputSegment {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'error';
  content?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  message?: string;
}

const view = ref<'chat' | 'status' | 'settings'>('chat');
const activeSession = ref<string | null>(null);
const sessions = ref<Session[]>([]);
const messages = ref<ChatMessage[]>([]);
const sessionOutputs = ref<Record<string, OutputSegment[]>>({});

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

function upsertMessage(id: string, role: ChatMessage['role'], content: string, sessionId: string) {
  const existing = messages.value.find((m) => m.id === id);
  if (existing) {
    existing.content = content;
  } else {
    messages.value.push({ id, role, content, sessionId });
  }
}

onMounted(async () => {
  const res = await fetch('/api/state');
  if (res.ok) {
    const data = (await res.json()) as { sessions: Session[] };
    sessions.value = data.sessions ?? [];
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
    applyAgentEvent(segments, payload.event);
    sessionOutputs.value[key] = segments;

    const content = renderOutput(segments);
    if (!content) return;

    const messageId = `agent-${key}`;
    upsertMessage(messageId, 'assistant', content, payload.target.sessionId);
  });
});

function createSession() {
  const sessionId = `webui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
        :messages="messages.filter((m) => m.sessionId === activeSession)"
        @send="send"
      />
      <StatusView v-else-if="view === 'status'" />
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
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
</style>
