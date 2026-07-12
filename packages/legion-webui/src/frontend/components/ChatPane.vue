<script setup lang="ts">
import { ref } from 'vue';
import type { Workdir, Session, ChatMessage } from '../types.js';

const props = defineProps<{
  workdir?: Workdir;
  session?: Session;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  (e: 'send', content: string): void;
}>();

const input = ref('');

function submit() {
  if (!input.value.trim()) return;
  emit('send', input.value);
  input.value = '';
}
</script>

<template>
  <div class="chat-pane">
    <header class="chat-header">
      <div class="title">
        {{ session?.name ?? workdir?.name ?? 'Select a session' }}
      </div>
      <div v-if="session" class="meta">
        Agent: {{ session.agent }} | Workdir: {{ workdir?.name }}
      </div>
    </header>

    <div class="messages">
      <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.role">
        <div class="bubble">{{ msg.content }}</div>
      </div>
      <div v-if="!workdir" class="empty">Select a workdir or session from the sidebar.</div>
    </div>

    <footer class="composer">
      <input
        v-model="input"
        type="text"
        placeholder="Type a message..."
        :disabled="!workdir"
        @keydown.enter="submit"
      />
      <button :disabled="!workdir || !input.trim()" @click="submit">Send</button>
    </footer>
  </div>
</template>

<style scoped>
.chat-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chat-header {
  padding: 12px 16px;
  border-bottom: 1px solid #30363d;
  background: #161b22;
}
.title {
  font-weight: 600;
}
.meta {
  font-size: 12px;
  color: #8b949e;
  margin-top: 4px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.message {
  display: flex;
}
.message.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 70%;
  padding: 10px 14px;
  border-radius: 12px;
  background: #21262d;
  white-space: pre-wrap;
  word-break: break-word;
}
.message.user .bubble {
  background: #1f6feb;
  color: #fff;
}
.empty {
  color: #8b949e;
  text-align: center;
  margin-top: 40px;
}
.composer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #30363d;
  background: #161b22;
}
.composer input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
}
.composer button {
  padding: 10px 18px;
  border-radius: 8px;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
}
.composer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
