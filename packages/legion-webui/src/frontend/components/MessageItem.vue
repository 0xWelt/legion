<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatMessage, Session, OutputSegment } from '../types.js';

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

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw);
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

const segments = computed<OutputSegment[]>(() => {
  if (props.message.segments?.length) return props.message.segments;
  if (!isUser.value && props.message.content)
    return [{ type: 'text', content: props.message.content }];
  return [];
});
</script>

<template>
  <div class="message-row" :class="{ user: isUser }">
    <div v-if="!isUser" class="avatar" :class="avatarClass">{{ avatarLabel }}</div>
    <div class="message-body">
      <div class="message-meta">
        <span class="sender">{{ senderName }}</span>
      </div>

      <!-- User message: plain text -->
      <div v-if="isUser" class="bubble bubble-user">
        <div class="message-content plain">{{ message.content }}</div>
      </div>

      <!-- Assistant structured segments -->
      <template v-else-if="segments.length">
        <div
          v-for="(seg, idx) in segments"
          :key="idx"
          class="segment"
          :class="`segment-${seg.type}`"
        >
          <div v-if="seg.type === 'text'" class="bubble bubble-assistant">
            <div class="message-content" v-html="renderMarkdown(seg.content ?? '')" />
          </div>

          <details v-else-if="seg.type === 'thinking'" class="thinking" open>
            <summary>💭 Thinking</summary>
            <div class="thinking-body" v-html="renderMarkdown(seg.content ?? '')" />
          </details>

          <div v-else-if="seg.type === 'tool_call'" class="tool-panel">
            <div class="tool-header">
              <span class="tool-icon">🔧</span>
              <span class="tool-name">Tool call: {{ seg.toolName ?? 'unknown' }}</span>
            </div>
            <pre class="tool-body"><code>{{ formatJson(seg.input) }}</code></pre>
          </div>

          <div v-else-if="seg.type === 'tool_result'" class="tool-panel result">
            <div class="tool-header">
              <span class="tool-icon">✅</span>
              <span class="tool-name">Tool result</span>
            </div>
            <pre class="tool-body"><code>{{ seg.output ?? '' }}</code></pre>
          </div>

          <div v-else-if="seg.type === 'error'" class="error-banner">
            ❌ {{ seg.message ?? 'Unknown error' }}
          </div>
        </div>
      </template>

      <!-- Fallback: render whole content as markdown -->
      <div v-else class="bubble bubble-assistant">
        <div class="message-content" v-html="renderMarkdown(message.content)" />
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
  max-width: 92%;
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
  gap: 8px;
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

.message-content.plain {
  white-space: pre-wrap;
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

/* Structured segments */
.thinking {
  border: 1px solid #30363d;
  border-radius: 10px;
  background: #161b22;
  overflow: hidden;
}
.thinking summary {
  padding: 8px 12px;
  font-size: 12px;
  color: #8b949e;
  cursor: pointer;
  user-select: none;
}
.thinking summary:hover {
  color: #c9d1d9;
}
.thinking-body {
  padding: 0 14px 12px;
  font-size: 13px;
  color: #c9d1d9;
  line-height: 1.5;
}
.thinking-body :deep(p) {
  margin: 0 0 6px;
}
.thinking-body :deep(p:last-child) {
  margin-bottom: 0;
}

.tool-panel {
  border: 1px solid #30363d;
  border-radius: 10px;
  background: #161b22;
  overflow: hidden;
  min-width: 320px;
}
.tool-panel.result {
  border-left: 3px solid #2ea043;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #0d1117;
  border-bottom: 1px solid #30363d;
  font-size: 12px;
  font-weight: 600;
  color: #c9d1d9;
}
.tool-icon {
  font-size: 13px;
}
.tool-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.tool-body {
  margin: 0;
  padding: 12px;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
}
.tool-body code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.error-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  color: #f85149;
  font-size: 13px;
}

.segment + .segment {
  margin-top: 8px;
}
</style>
