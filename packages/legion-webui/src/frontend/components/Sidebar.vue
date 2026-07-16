<script setup lang="ts">
import type { Session } from '../types.js';

defineProps<{
  sessions: Session[];
  activeSession: string | null;
  currentView: 'chat' | 'settings';
}>();

const emit = defineEmits<{
  (e: 'select-session', sessionId: string): void;
  (e: 'create-session'): void;
  (e: 'switch-view', view: 'chat' | 'settings'): void;
}>();

function statusClass(status: string): string {
  return `status-${status}`;
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-icon">◆</span>
      Legion
    </div>

    <nav class="nav">
      <button :class="{ active: currentView === 'chat' }" @click="emit('switch-view', 'chat')">
        <span class="nav-icon">💬</span>
        <span class="nav-label">Chat</span>
        <span class="chevron" :class="{ expanded: currentView === 'chat' }">▶</span>
      </button>
      <button
        :class="{ active: currentView === 'settings' }"
        @click="emit('switch-view', 'settings')"
      >
        <span class="nav-icon">⚙️</span> Settings
      </button>
    </nav>

    <div v-if="currentView === 'chat'" class="chat-sidebar">
      <div class="section-header">
        <div class="section-title">Conversations</div>
        <button class="new-btn" @click="emit('create-session')">+ New</button>
      </div>
      <div class="session-list">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="session"
          :data-session-id="session.id"
          :class="{ active: activeSession === session.id }"
          @click="emit('select-session', session.id)"
        >
          <div class="session-name">{{ session.name }}</div>
          <div class="session-meta">
            <span class="agent">{{ session.agent }}</span>
            <span class="status" :class="statusClass(session.status)">{{ session.status }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  background: #161b22;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  color: #c9d1d9;
}
.brand {
  padding: 16px;
  font-size: 18px;
  font-weight: 700;
  border-bottom: 1px solid #30363d;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #e6edf3;
}
.brand-icon {
  color: #1f6feb;
}
.nav {
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 4px;
}
.nav button {
  background: transparent;
  border: none;
  color: #c9d1d9;
  text-align: left;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.nav button:hover {
  background: #21262d;
}
.nav button.active {
  background: #1f6feb;
  color: #fff;
}
.nav-icon {
  font-size: 15px;
  width: 20px;
  text-align: center;
}
.nav-label {
  flex: 1;
}
.chevron {
  font-size: 10px;
  transition: transform 0.2s ease;
  color: #8b949e;
}
.nav button.active .chevron {
  color: #fff;
}
.chevron.expanded {
  transform: rotate(90deg);
}

.chat-sidebar {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 4px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.new-btn {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.new-btn:hover {
  background: #30363d;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.session-list::-webkit-scrollbar {
  width: 6px;
}
.session-list::-webkit-scrollbar-track {
  background: transparent;
}
.session-list::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 3px;
}
.session {
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 6px;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}
.session:hover {
  background: #21262d;
}
.session.active {
  background: rgba(31, 111, 235, 0.1);
  border-color: rgba(31, 111, 235, 0.3);
}
.session-name {
  font-weight: 600;
  font-size: 14px;
  color: #e6edf3;
  word-break: break-all;
}
.session-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
.agent {
  font-size: 11px;
  color: #58a6ff;
  background: rgba(31, 111, 235, 0.15);
  padding: 2px 8px;
  border-radius: 10px;
}
.status {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  background: #30363d;
  color: #8b949e;
  flex-shrink: 0;
  text-transform: lowercase;
}
.status-running {
  background: rgba(31, 111, 235, 0.2);
  color: #58a6ff;
}
.status-error {
  background: rgba(218, 54, 51, 0.2);
  color: #f85149;
}
</style>
