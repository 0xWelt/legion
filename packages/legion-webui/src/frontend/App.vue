<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ChatPane from './components/ChatPane.vue';
import StatusView from './views/StatusView.vue';
import SettingsView from './views/SettingsView.vue';
import { useWebSocket } from './composables/useWebSocket.js';
import type { Workdir, Session, ChatMessage } from './types.js';

const view = ref<'chat' | 'status' | 'settings'>('chat');
const activeWorkdir = ref<string | null>(null);
const activeSession = ref<string | null>(null);
const workdirs = ref<Workdir[]>([]);
const sessions = ref<Session[]>([]);
const messages = ref<ChatMessage[]>([]);

const ws = useWebSocket();

onMounted(async () => {
  // Load workdirs/sessions from state endpoint or local state
  const res = await fetch('/api/state');
  if (res.ok) {
    const data = (await res.json()) as { workdirs: Workdir[]; sessions: Session[] };
    workdirs.value = data.workdirs ?? [];
    sessions.value = data.sessions ?? [];
  }

  ws.on('text', (payload: { target: { channelId: string; threadId?: string }; text: string }) => {
    messages.value.push({
      id: `${Date.now()}`,
      role: 'assistant',
      content: payload.text,
      channelId: payload.target.channelId,
      threadId: payload.target.threadId,
    });
  });

  ws.on(
    'agent-event',
    (payload: {
      target: { channelId: string; threadId?: string };
      event: { type: string; text?: string };
    }) => {
      const text = payload.event.text ?? '';
      if (text) {
        messages.value.push({
          id: `${Date.now()}`,
          role: 'assistant',
          content: text,
          channelId: payload.target.channelId,
          threadId: payload.target.threadId,
        });
      }
    }
  );
});

function send(content: string) {
  if (!activeWorkdir.value) return;
  ws.send({
    type: 'message',
    channelId: activeWorkdir.value,
    threadId: activeSession.value ?? undefined,
    content,
  });
  messages.value.push({
    id: `${Date.now()}`,
    role: 'user',
    content,
    channelId: activeWorkdir.value,
    threadId: activeSession.value ?? undefined,
  });
}

function selectSession(workdirId: string, sessionId?: string) {
  activeWorkdir.value = workdirId;
  activeSession.value = sessionId ?? null;
  view.value = 'chat';
}
</script>

<template>
  <div class="app-shell">
    <Sidebar
      :workdirs="workdirs"
      :sessions="sessions"
      :active-workdir="activeWorkdir"
      :active-session="activeSession"
      :current-view="view"
      @select-session="selectSession"
      @switch-view="view = $event"
    />
    <main class="main">
      <ChatPane
        v-if="view === 'chat'"
        :workdir="workdirs.find((w) => w.id === activeWorkdir)"
        :session="sessions.find((s) => s.id === activeSession)"
        :messages="
          messages.filter(
            (m) =>
              m.channelId === activeWorkdir &&
              (activeSession ? m.threadId === activeSession : !m.threadId)
          )
        "
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
