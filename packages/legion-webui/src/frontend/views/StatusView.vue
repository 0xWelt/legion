<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface ServiceStatus {
  loaded: boolean;
  active?: 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
  enabled?: boolean;
  serviceName?: string;
  unitPath?: string;
  version?: string;
  mode?: 'dev' | 'npm' | 'unknown';
}

const status = ref<ServiceStatus | null>(null);
const loading = ref(false);
const error = ref('');

async function fetchStatus() {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/status');
    status.value = (await res.json()) as ServiceStatus;
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function action(name: string) {
  try {
    await fetch(`/api/service/${name}`, { method: 'POST' });
    await fetchStatus();
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(fetchStatus);

function statusClass(active?: string): string {
  switch (active) {
    case 'active':
      return 'ok';
    case 'failed':
      return 'error';
    case 'activating':
      return 'warn';
    case 'inactive':
      return 'warn';
    default:
      return 'muted';
  }
}
</script>

<template>
  <div class="status-view">
    <div class="page-header">
      <h1>Service Status</h1>
      <button class="refresh-btn" :disabled="loading" @click="fetchStatus">Refresh</button>
    </div>

    <div v-if="loading" class="loading">Loading service status...</div>
    <div v-else-if="error" class="error-card">{{ error }}</div>

    <div v-else-if="status" class="cards">
      <div class="card status-card">
        <h2>Gateway</h2>
        <div class="status-row">
          <span class="label">Version</span>
          <span class="value mono">{{ status.version ?? 'unknown' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Install mode</span>
          <span class="value badge">{{ status.mode ?? 'unknown' }}</span>
        </div>
      </div>

      <div class="card status-card">
        <h2>Systemd service</h2>
        <div class="status-row">
          <span class="label">Service name</span>
          <span class="value mono">{{ status.serviceName ?? '—' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Loaded</span>
          <span class="value" :class="status.loaded ? 'ok' : 'warn'">{{
            status.loaded ? 'Yes' : 'No'
          }}</span>
        </div>
        <div class="status-row">
          <span class="label">Active</span>
          <span class="value" :class="statusClass(status.active)">{{
            status.active ?? 'unknown'
          }}</span>
        </div>
        <div class="status-row">
          <span class="label">Enabled</span>
          <span class="value" :class="status.enabled ? 'ok' : 'warn'">{{
            status.enabled ? 'Yes' : 'No'
          }}</span>
        </div>
        <div v-if="status.unitPath" class="status-row">
          <span class="label">Unit path</span>
          <span class="value mono path" :title="status.unitPath">{{ status.unitPath }}</span>
        </div>

        <div class="actions">
          <button @click="action('start')">Start</button>
          <button @click="action('stop')">Stop</button>
          <button @click="action('restart')">Restart</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-view {
  padding: 24px;
  max-width: 960px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
h1 {
  margin: 0;
  color: #e6edf3;
  font-size: 22px;
}
.refresh-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  transition: background 0.15s ease;
}
.refresh-btn:hover:not(:disabled) {
  background: #30363d;
}
.loading {
  color: #8b949e;
}
.error-card {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  color: #f85149;
  padding: 14px;
  border-radius: 10px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 18px;
}
.card h2 {
  margin: 0 0 14px;
  font-size: 14px;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #21262d;
}
.status-row:last-child {
  border-bottom: none;
}
.label {
  color: #8b949e;
  font-size: 14px;
}
.value {
  font-size: 14px;
  color: #c9d1d9;
  text-align: right;
  word-break: break-word;
  min-width: 0;
}
.value.path {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(31, 111, 235, 0.15);
  color: #58a6ff;
  font-size: 12px;
  font-weight: 600;
}
.ok {
  color: #3fb950;
}
.warn {
  color: #f0883e;
}
.error {
  color: #f85149;
}
.muted {
  color: #8b949e;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.actions button {
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
}
.actions button:hover {
  background: #388bfd;
}
</style>
