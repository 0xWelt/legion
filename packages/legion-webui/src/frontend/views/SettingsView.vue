<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { LegionConfig, AgentConfig, IMProviderStatus } from '../types.js';

interface ServiceStatus {
  loaded: boolean;
  active?: 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
  enabled?: boolean;
  serviceName?: string;
  unitPath?: string;
  version?: string;
  mode?: 'dev' | 'npm' | 'unknown';
}

interface ProviderInfo {
  name: string;
  configured: boolean;
  summary: string;
}

const config = ref<LegionConfig>({});
const configPath = ref<string | undefined>(undefined);
const status = ref<ServiceStatus | null>(null);
const providers = ref<ProviderInfo[]>([]);
const saving = ref(false);
const saved = ref(false);
const loading = ref(true);
const error = ref('');
const providerDrafts = ref<Record<string, string>>({});
const agentEnvDrafts = ref<Record<string, string>>({});

const SYSTEM_KEYS = new Set(['defaultAgent', 'agents', 'stateStore']);

const defaultAgent = computed({
  get: () => config.value.defaultAgent ?? '',
  set: (v) => {
    config.value = { ...config.value, defaultAgent: v || undefined };
  },
});

const stateStorePath = computed({
  get: () => config.value.stateStore?.path ?? '',
  set: (v) => {
    config.value = {
      ...config.value,
      stateStore: { ...config.value.stateStore, path: v },
    };
  },
});

const agents = computed(() => config.value.agents ?? {});
const providerNames = computed(() => providers.value.map((p) => p.name).sort());

function envToString(env?: Record<string, string>): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function stringToEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function addAgent() {
  const name = `agent-${Date.now()}`;
  config.value = {
    ...config.value,
    agents: { ...config.value.agents, [name]: { binary: '', env: {} } },
  };
  agentEnvDrafts.value[name] = '';
}

function removeAgent(name: string) {
  const next = { ...config.value.agents };
  delete next[name];
  config.value = { ...config.value, agents: next };
  delete agentEnvDrafts.value[name];
}

function updateAgentName(oldName: string, newName: string) {
  newName = newName.trim();
  if (!newName || oldName === newName) return;
  const list = { ...config.value.agents };
  const entry = list[oldName];
  if (!entry) return;
  delete list[oldName];
  list[newName] = entry;
  config.value = { ...config.value, agents: list };
  agentEnvDrafts.value[newName] = agentEnvDrafts.value[oldName] ?? '';
  delete agentEnvDrafts.value[oldName];
}

function updateAgentBinary(name: string, binary: string) {
  config.value = {
    ...config.value,
    agents: {
      ...config.value.agents,
      [name]: { ...config.value.agents?.[name], binary },
    },
  };
}

function getProviderDraft(name: string): string {
  if (providerDrafts.value[name] === undefined) {
    const existing = config.value[name];
    providerDrafts.value[name] = JSON.stringify(existing ?? {}, null, 2);
  }
  return providerDrafts.value[name];
}

function setProviderDraft(name: string, value: string) {
  providerDrafts.value[name] = value;
}

async function fetchAll() {
  loading.value = true;
  error.value = '';
  try {
    const [statusRes, configRes, providersRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/config'),
      fetch('/api/providers'),
    ]);
    status.value = (await statusRes.json()) as ServiceStatus;
    const configData = (await configRes.json()) as { config: LegionConfig; configPath?: string };
    config.value = configData.config ?? {};
    configPath.value = configData.configPath;
    providers.value = ((await providersRes.json()) as { providers: ProviderInfo[] }).providers;

    // Seed provider JSON drafts from current config.
    for (const p of providers.value) {
      const existing = configData.config?.[p.name];
      providerDrafts.value[p.name] = JSON.stringify(existing ?? {}, null, 2);
    }

    // Seed agent env drafts.
    for (const [name, entry] of Object.entries(configData.config?.agents ?? {})) {
      agentEnvDrafts.value[name] = envToString((entry as AgentConfig).env);
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function action(name: string) {
  try {
    await fetch(`/api/service/${name}`, { method: 'POST' });
    await fetchAll();
  } catch (e) {
    error.value = String(e);
  }
}

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = '';

  // Build clean payload from current UI state.
  const payload: LegionConfig = {
    ...(config.value.defaultAgent ? { defaultAgent: config.value.defaultAgent } : {}),
    stateStore: config.value.stateStore ?? { path: '~/.legion/state.json' },
  };

  if (config.value.agents && Object.keys(config.value.agents).length > 0) {
    payload.agents = {};
    for (const [name, entry] of Object.entries(config.value.agents)) {
      const envText = agentEnvDrafts.value[name] ?? '';
      const env = stringToEnv(envText);
      payload.agents[name] = {
        ...(entry as AgentConfig),
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
    }
  }

  for (const p of providers.value) {
    const text = providerDrafts.value[p.name] ?? '{}';
    try {
      payload[p.name] = JSON.parse(text);
    } catch (e) {
      error.value = `Invalid JSON for provider "${p.name}": ${String(e)}`;
      saving.value = false;
      return;
    }
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

const rawConfig = computed(() => JSON.stringify(config.value, null, 2));

onMounted(fetchAll);

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
  <div class="settings-view">
    <div class="page-header">
      <h1>Settings</h1>
      <button class="refresh-btn" :disabled="loading" @click="fetchAll">Refresh</button>
    </div>

    <div v-if="loading" class="loading">Loading configuration...</div>
    <div v-else-if="error" class="error-card">{{ error }}</div>

    <div v-else class="cards">
      <!-- Gateway -->
      <div class="card">
        <h2>Gateway</h2>
        <div class="status-row">
          <span class="label">Version</span>
          <span class="value mono">{{ status?.version ?? 'unknown' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Install mode</span>
          <span class="value badge">{{ status?.mode ?? 'unknown' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Service name</span>
          <span class="value mono">{{ status?.serviceName ?? '—' }}</span>
        </div>
        <div class="status-row">
          <span class="label">Loaded</span>
          <span class="value" :class="status?.loaded ? 'ok' : 'warn'">
            {{ status?.loaded ? 'Yes' : 'No' }}
          </span>
        </div>
        <div class="status-row">
          <span class="label">Active</span>
          <span class="value" :class="statusClass(status?.active)">{{
            status?.active ?? 'unknown'
          }}</span>
        </div>
        <div class="status-row">
          <span class="label">Enabled</span>
          <span class="value" :class="status?.enabled ? 'ok' : 'warn'">
            {{ status?.enabled ? 'Yes' : 'No' }}
          </span>
        </div>
        <div v-if="status?.unitPath" class="status-row">
          <span class="label">Unit path</span>
          <span class="value mono path" :title="status.unitPath">{{ status.unitPath }}</span>
        </div>

        <div class="actions">
          <button @click="action('start')">Start</button>
          <button @click="action('stop')">Stop</button>
          <button @click="action('restart')">Restart</button>
        </div>
      </div>

      <!-- General -->
      <div class="card">
        <h2>General</h2>

        <label>
          Default Agent
          <input v-model="defaultAgent" type="text" placeholder="e.g. kimi-code" />
        </label>

        <label>
          State Store Path
          <input v-model="stateStorePath" type="text" placeholder="~/.legion/state.json" />
        </label>
      </div>

      <!-- Agents -->
      <div class="card">
        <div class="card-header">
          <h2>Agents</h2>
          <button class="small" @click="addAgent">+ Add</button>
        </div>

        <div v-if="Object.keys(agents).length === 0" class="empty">No custom agents.</div>

        <div v-for="(entry, name) in agents" :key="name" class="agent-row">
          <div class="agent-field">
            <label>Name</label>
            <input
              :value="name"
              type="text"
              @change="updateAgentName(name, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="agent-field">
            <label>Binary</label>
            <input
              :value="(entry as AgentConfig).binary ?? ''"
              type="text"
              placeholder="optional binary path"
              @input="updateAgentBinary(name, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="agent-field">
            <label>Environment (KEY=VALUE per line)</label>
            <textarea v-model="agentEnvDrafts[name]" rows="3" placeholder="API_KEY=xxx" />
          </div>
          <button class="danger small" @click="removeAgent(name)">Remove</button>
        </div>
      </div>

      <!-- IM Providers -->
      <div class="card">
        <h2>IM Providers</h2>

        <div v-for="p in providers" :key="p.name" class="provider-row">
          <div class="provider-header">
            <span class="provider-name">{{ p.name }}</span>
            <span class="badge" :class="p.configured ? 'ok' : 'warn'">
              {{ p.configured ? 'configured' : 'incomplete' }}
            </span>
          </div>
          <div v-if="p.summary" class="provider-summary">{{ p.summary }}</div>
          <textarea
            :value="getProviderDraft(p.name)"
            rows="6"
            class="code"
            spellcheck="false"
            @input="setProviderDraft(p.name, ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
      </div>

      <!-- Raw config + save -->
      <div class="card">
        <h2>Configuration file</h2>
        <div class="info-row">
          <span class="info-label">Path</span>
          <span class="info-value mono" :title="configPath">{{ configPath ?? 'unknown' }}</span>
        </div>
        <pre class="raw-config">{{ rawConfig }}</pre>

        <div v-if="saved" class="saved">Saved successfully.</div>
        <button :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save' }}</button>
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
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
label {
  display: block;
  margin-bottom: 14px;
  color: #c9d1d9;
  font-size: 13px;
}
input,
textarea {
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
  font-family: inherit;
}
textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
textarea.code {
  min-height: 120px;
}
input:focus,
textarea:focus {
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
button.small {
  padding: 5px 12px;
  font-size: 12px;
}
button.danger {
  background: #da3633;
}
button.danger:hover:not(:disabled) {
  background: #f85149;
}
.saved {
  color: #3fb950;
  margin-bottom: 12px;
  font-size: 14px;
}
.empty {
  color: #8b949e;
  font-size: 13px;
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
.badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(31, 111, 235, 0.15);
  color: #58a6ff;
  font-size: 12px;
  font-weight: 600;
}
.badge.ok {
  background: rgba(46, 160, 67, 0.15);
  color: #3fb950;
}
.badge.warn {
  background: rgba(210, 153, 34, 0.15);
  color: #f0883e;
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
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.actions button:hover {
  background: #388bfd;
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
  margin: 0 0 16px;
}
.agent-row {
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
  background: #0d1117;
}
.agent-field {
  margin-bottom: 10px;
}
.agent-field:last-child {
  margin-bottom: 0;
}
.provider-row {
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
  background: #0d1117;
}
.provider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.provider-name {
  font-weight: 600;
  font-size: 14px;
  color: #e6edf3;
}
.provider-summary {
  font-size: 12px;
  color: #8b949e;
  margin-bottom: 10px;
}
</style>
