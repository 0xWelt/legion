<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';

const config = ref<Record<string, unknown>>({});
const configPath = ref<string | undefined>(undefined);
const saving = ref(false);
const saved = ref(false);
const loading = ref(true);
const error = ref('');

const defaultAgent = computed({
  get: () => (config.value.defaultAgent as string) ?? '',
  set: (v) => {
    config.value = { ...config.value, defaultAgent: v };
  },
});

const stateStorePath = computed({
  get: () =>
    ((config.value.stateStore as Record<string, string> | undefined)?.path as string) ?? '',
  set: (v) => {
    config.value = {
      ...config.value,
      stateStore: { ...(config.value.stateStore as Record<string, string> | undefined), path: v },
    };
  },
});

const rawConfig = computed(() => JSON.stringify(config.value, null, 2));

onMounted(async () => {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = (await res.json()) as { config: Record<string, unknown>; configPath?: string };
      config.value = data.config ?? {};
      configPath.value = data.configPath;
    } else {
      error.value = `Failed to load config: ${res.status}`;
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value),
    });
    saved.value = res.ok;
    if (!res.ok) {
      error.value = `Save failed: ${res.status}`;
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="settings-view">
    <h1>Settings</h1>

    <div v-if="loading" class="loading">Loading configuration...</div>
    <div v-else-if="error" class="error-card">{{ error }}</div>

    <div v-else class="cards">
      <div class="card">
        <h2>General</h2>

        <label>
          Default Agent
          <input v-model="defaultAgent" type="text" />
        </label>

        <label>
          State Store Path
          <input v-model="stateStorePath" type="text" />
        </label>

        <div v-if="saved" class="saved">Saved successfully.</div>
        <button :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save' }}</button>
      </div>

      <div class="card">
        <h2>Configuration file</h2>
        <div class="info-row">
          <span class="info-label">Path</span>
          <span class="info-value mono" :title="configPath">{{ configPath ?? 'unknown' }}</span>
        </div>
        <pre class="raw-config">{{ rawConfig }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 960px;
  box-sizing: border-box;
}
h1 {
  margin: 0 0 20px;
  color: #e6edf3;
  font-size: 22px;
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
  margin-bottom: 16px;
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
  min-width: 0;
}
.card h2 {
  margin: 0 0 14px;
  font-size: 14px;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
label {
  display: block;
  margin-bottom: 16px;
  color: #c9d1d9;
  font-size: 14px;
}
input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 14px;
  outline: none;
}
input:focus {
  border-color: #1f6feb;
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.2);
}
button {
  padding: 9px 18px;
  border-radius: 8px;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s ease;
}
button:hover:not(:disabled) {
  background: #388bfd;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.saved {
  color: #3fb950;
  margin-bottom: 12px;
  font-size: 14px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #21262d;
}
.info-label {
  color: #8b949e;
  font-size: 13px;
}
.info-value {
  color: #c9d1d9;
  font-size: 13px;
  text-align: right;
  word-break: break-all;
  min-width: 0;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.raw-config {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  color: #c9d1d9;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
</style>
