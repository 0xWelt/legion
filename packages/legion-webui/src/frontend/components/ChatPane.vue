<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import MessageItem from './MessageItem.vue';
import type { Session, ChatMessage } from '../types.js';

const props = defineProps<{
  session?: Session;
  sessionId?: string | null;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  (e: 'send', content: string): void;
}>();

const input = ref('');
const textarea = ref<HTMLTextAreaElement | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);
const disabled = computed(() => !props.sessionId);

function submit() {
  const text = input.value.trim();
  if (!text || disabled.value) return;
  emit('send', text);
  input.value = '';
  resizeTextarea();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submit();
  }
}

function resizeTextarea() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    messagesContainer.value?.scrollTo({
      top: messagesContainer.value.scrollHeight,
      behavior: 'smooth',
    });
  }
);
</script>

<template>
  <div class="chat-pane">
    <header class="chat-header">
      <div class="title">
        {{ session?.name ?? (sessionId ? 'New session' : 'Select or create a session') }}
      </div>
      <div v-if="session" class="meta">
        <span class="badge">{{ session.agent }}</span>
        <span v-if="session.path" class="path" :title="session.path">{{ session.path }}</span>
      </div>
    </header>

    <div ref="messagesContainer" class="messages">
      <div v-if="!sessionId" class="empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">Select a session from the sidebar or start a new one.</div>
        <div class="empty-sub">
          Each session is an independent chat with its own workdir and agent.
        </div>
      </div>
      <template v-else>
        <MessageItem v-for="msg in messages" :key="msg.id" :message="msg" :session="session" />
      </template>
    </div>

    <footer class="composer">
      <textarea
        ref="textarea"
        v-model="input"
        :disabled="disabled"
        :placeholder="
          disabled
            ? 'Select a session to start chatting'
            : 'Type a message... (Shift+Enter for newline)'
        "
        rows="1"
        @keydown="onKeydown"
        @input="resizeTextarea"
      />
      <button :disabled="disabled || !input.trim()" @click="submit">Send</button>
    </footer>
  </div>
</template>

<style scoped>
.chat-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #0d1117;
}
.chat-header {
  padding: 14px 20px;
  border-bottom: 1px solid #30363d;
  background: #161b22;
}
.title {
  font-weight: 600;
  font-size: 15px;
  color: #e6edf3;
}
.meta {
  font-size: 12px;
  color: #8b949e;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(31, 111, 235, 0.15);
  color: #58a6ff;
  font-size: 11px;
  font-weight: 600;
}
.path {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.messages::-webkit-scrollbar {
  width: 8px;
}
.messages::-webkit-scrollbar-track {
  background: transparent;
}
.messages::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 4px;
}

.empty {
  margin: auto;
  text-align: center;
  color: #8b949e;
}
.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
}
.empty-title {
  font-size: 15px;
  font-weight: 500;
  color: #c9d1d9;
  margin-bottom: 4px;
}
.empty-sub {
  font-size: 13px;
}

.composer {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  padding: 14px 20px;
  border-top: 1px solid #30363d;
  background: #161b22;
}
.composer textarea {
  flex: 1;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  max-height: 160px;
  min-height: 40px;
  font-family: inherit;
  outline: none;
}
.composer textarea:focus {
  border-color: #1f6feb;
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.2);
}
.composer textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.composer button {
  padding: 10px 20px;
  border-radius: 12px;
  border: none;
  background: #1f6feb;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}
.composer button:hover:not(:disabled) {
  background: #388bfd;
}
.composer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
