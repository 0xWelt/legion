<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface ServiceStatus {
  loaded: boolean;
  active?: string;
  enabled?: boolean;
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
</script>

<template>
  <div class="status-view">
    <h1>Service Status</h1>
    <div v-if="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="status" class="card">
      <div class="row">
        <span>Loaded:</span>
        <span :class="status.loaded ? 'ok' : 'warn'">{{ status.loaded ? 'Yes' : 'No' }}</span>
      </div>
      <div class="row">
        <span>Active:</span>
        <span :class="status.active">{{ status.active ?? 'unknown' }}</span>
      </div>
      <div class="row">
        <span>Enabled:</span>
        <span :class="status.enabled ? 'ok' : 'warn'">{{ status.enabled ? 'Yes' : 'No' }}</span>
      </div>

      <div class="actions">
        <button @click="action('start')">Start</button>
        <button @click="action('stop')">Stop</button>
        <button @click="action('restart')">Restart</button>
        <button @click="fetchStatus">Refresh</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-view {
  padding: 24px;
}
h1 {
  margin-top: 0;
}
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  max-width: 480px;
}
.row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #21262d;
}
.row:last-child {
  border-bottom: none;
}
.ok {
  color: #3fb950;
}
.warn {
  color: #f0883e;
}
.error {
  color: #da3633;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.actions button {
  padding: 8px 14px;
  border-radius: 6px;
  border: none;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
}
.actions button:hover {
  background: #30363d;
}
</style>
