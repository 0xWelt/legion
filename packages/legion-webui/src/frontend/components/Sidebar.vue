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
</script>

<template>
  <aside class="sidebar">
    <div class="brand">Legion</div>
    <nav class="nav">
      <button :class="{ active: currentView === 'chat' }" @click="emit('switch-view', 'chat')">
        Chat
      </button>
      <button :class="{ active: currentView === 'status' }" @click="emit('switch-view', 'status')">
        Status
      </button>
      <button
        :class="{ active: currentView === 'settings' }"
        @click="emit('switch-view', 'settings')"
      >
        Settings
      </button>
    </nav>

    <div class="workdir-list">
      <div
        v-for="workdir in workdirs"
        :key="workdir.id"
        class="workdir"
        :class="{ active: activeWorkdir === workdir.id && !activeSession }"
        @click="emit('select-session', workdir.id)"
      >
        <div class="workdir-name">{{ workdir.name }}</div>
        <div class="session-list">
          <div
            v-for="session in sessionsFor(workdir.id, sessions)"
            :key="session.id"
            class="session"
            :class="{ active: activeSession === session.id }"
            @click.stop="emit('select-session', workdir.id, session.id)"
          >
            {{ session.name }}
            <span class="status" :class="session.status">{{ session.status }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px;
  background: #161b22;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
}
.brand {
  padding: 16px;
  font-size: 18px;
  font-weight: 700;
  border-bottom: 1px solid #30363d;
}
.nav {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
}
.nav button {
  background: transparent;
  border: none;
  color: #c9d1d9;
  text-align: left;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.nav button:hover,
.nav button.active {
  background: #21262d;
  color: #fff;
}
.workdir-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.workdir {
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.workdir:hover,
.workdir.active {
  background: #21262d;
}
.workdir-name {
  font-weight: 600;
  margin-bottom: 4px;
}
.session-list {
  padding-left: 12px;
}
.session {
  padding: 4px 8px;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.session:hover,
.session.active {
  background: #30363d;
}
.status {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #30363d;
}
.status.running {
  background: #1f6feb;
}
.status.error {
  background: #da3633;
}
</style>
