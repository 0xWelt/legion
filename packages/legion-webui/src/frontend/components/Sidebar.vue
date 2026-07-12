<script setup lang="ts">
import type { Workdir, Session } from '../types.js';

defineProps<{
  workdirs: Workdir[];
  sessions: Session[];
  activeWorkdir: string | null;
  activeSession: string | null;
  currentView: 'chat' | 'status' | 'settings';
}>();

const emit = defineEmits<{
  (e: 'select-session', workdirId: string, sessionId?: string): void;
  (e: 'switch-view', view: 'chat' | 'status' | 'settings'): void;
}>();

function sessionsFor(workdirId: string, list: Session[]) {
  return list.filter((s) => s.workdirId === workdirId);
}

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
        <span class="nav-icon">💬</span> Chat
      </button>
      <button :class="{ active: currentView === 'status' }" @click="emit('switch-view', 'status')">
        <span class="nav-icon">📊</span> Status
      </button>
      <button
        :class="{ active: currentView === 'settings' }"
        @click="emit('switch-view', 'settings')"
      >
        <span class="nav-icon">⚙️</span> Settings
      </button>
    </nav>

    <div class="section-title">Workdirs</div>

    <div class="workdir-list">
      <div
        v-for="workdir in workdirs"
        :key="workdir.id"
        class="workdir"
        :class="{ active: activeWorkdir === workdir.id && !activeSession }"
        @click="emit('select-session', workdir.id)"
      >
        <div class="workdir-header">
          <div class="workdir-name">{{ workdir.name }}</div>
          <div class="workdir-path" :title="workdir.path">{{ workdir.path }}</div>
        </div>

        <div class="session-list">
          <div
            v-for="session in sessionsFor(workdir.id, sessions)"
            :key="session.id"
            class="session"
            :class="{ active: activeSession === session.id }"
            @click.stop="emit('select-session', workdir.id, session.id)"
          >
            <span class="session-name">{{ session.name }}</span>
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

.section-title {
  padding: 10px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.workdir-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.workdir-list::-webkit-scrollbar {
  width: 6px;
}
.workdir-list::-webkit-scrollbar-track {
  background: transparent;
}
.workdir-list::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 3px;
}
.workdir {
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 6px;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}
.workdir:hover {
  background: #21262d;
}
.workdir.active {
  background: rgba(31, 111, 235, 0.1);
  border-color: rgba(31, 111, 235, 0.3);
}
.workdir-header {
  margin-bottom: 6px;
}
.workdir-name {
  font-weight: 600;
  font-size: 14px;
  color: #e6edf3;
  word-break: break-all;
}
.workdir-path {
  font-size: 11px;
  color: #6e7681;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-list {
  padding-left: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.session {
  padding: 5px 8px;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  transition: background 0.15s ease;
}
.session:hover {
  background: #30363d;
}
.session.active {
  background: #30363d;
  font-weight: 500;
}
.session-name {
  color: #c9d1d9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
