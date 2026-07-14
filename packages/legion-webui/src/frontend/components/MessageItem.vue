<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage, Session } from '../types.js';

const props = defineProps<{
  message: ChatMessage;
  session?: Session;
}>();

const isUser = computed(() => props.message.role === 'user');
const senderName = computed(() => (isUser.value ? 'You' : (props.session?.agent ?? 'Agent')));
const avatarLabel = computed(() => (isUser.value ? 'Y' : firstChar(props.session?.agent ?? 'A')));
const avatarClass = computed(() => (isUser.value ? 'avatar-user' : 'avatar-agent'));

function firstChar(s: string): string {
  return s.charAt(0).toUpperCase();
}

const renderedContent = computed(() => {
  const raw = marked.parse(props.message.content, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;
  return DOMPurify.sanitize(raw);
});
</script>

<template>
  <div class="message-row" :class="{ user: isUser }">
    <div v-if="!isUser" class="avatar" :class="avatarClass">{{ avatarLabel }}</div>
    <div class="message-body">
      <div class="message-meta">
        <span class="sender">{{ senderName }}</span>
      </div>
      <div class="bubble" :class="{ 'bubble-user': isUser, 'bubble-assistant': !isUser }">
        <div class="message-content" v-html="renderedContent"></div>
      </div>
    </div>
    <div v-if="isUser" class="avatar avatar-user">{{ avatarLabel }}</div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  max-width: 85%;
}
.message-row.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
  user-select: none;
}
.avatar-agent {
  background: linear-gradient(135deg, #1f6feb, #2ea043);
}
.avatar-user {
  background: #30363d;
}

.message-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.message-row.user .message-body {
  align-items: flex-end;
}

.message-meta {
  font-size: 12px;
  color: #8b949e;
  padding: 0 4px;
}

.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  line-height: 1.55;
  font-size: 14px;
  word-break: break-word;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
.bubble-user {
  background: #1f6feb;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.bubble-assistant {
  background: #21262d;
  color: #c9d1d9;
  border-bottom-left-radius: 4px;
}

.message-content :deep(p) {
  margin: 0 0 8px;
}
.message-content :deep(p:last-child) {
  margin-bottom: 0;
}
.message-content :deep(pre) {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.message-content :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.message-content :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  color: #e6edf3;
}
.message-content :deep(:not(pre) > code) {
  background: rgba(175, 184, 193, 0.2);
  padding: 2px 5px;
  border-radius: 4px;
  color: inherit;
}
.message-content :deep(ul),
.message-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}
.message-content :deep(li) {
  margin: 4px 0;
}
.message-content :deep(a) {
  color: #58a6ff;
  text-decoration: none;
}
.message-content :deep(a:hover) {
  text-decoration: underline;
}
.message-content :deep(hr) {
  border: 0;
  border-top: 1px solid #30363d;
  margin: 12px 0;
}
.message-content :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}
.message-content :deep(th),
.message-content :deep(td) {
  border: 1px solid #30363d;
  padding: 6px 10px;
  text-align: left;
}
.message-content :deep(th) {
  background: #161b22;
}
</style>
