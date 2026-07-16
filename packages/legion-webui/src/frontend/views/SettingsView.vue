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

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select';
  options?: string[];
  placeholder?: string;
}

const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  webui: [
    { key: 'host', label: 'Host', type: 'text', placeholder: '127.0.0.1' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '18788' },
    { key: 'authToken', label: 'Auth Token', type: 'password', placeholder: 'optional' },
  ],
  discord: [
    { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'MTIz...' },
    { key: 'allowedGuildId', label: 'Allowed Guild ID', type: 'text', placeholder: '1234567890' },
    { key: 'editDebounceMs', label: 'Edit Debounce (ms)', type: 'number', placeholder: '1000' },
  ],
  lark: [
    { key: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_xxx' },
    { key: 'appSecret', label: 'App Secret', type: 'password' },
    { key: 'mode', label: 'Mode', type: 'select', options: ['webhook', 'long-connection'] },
    { key: 'webhookPort', label: 'Webhook Port', type: 'number', placeholder: '3000' },
    { key: 'webhookPath', label: 'Webhook Path', type: 'text', placeholder: '/webhook/event' },
    { key: 'encryptKey', label: 'Encrypt Key', type: 'password', placeholder: 'optional' },
    {
      key: 'verificationToken',
      label: 'Verification Token',
      type: 'password',
      placeholder: 'optional',
    },
  ],
};

const PROVIDER_ICONS: Record<string, string> = {
  webui: '🌐',
  discord: '🎮',
  lark: '🐦',
};

interface AgentStatus {
  name: string;
  configured: boolean;
  summary: string;
}

const config = ref<LegionConfig>({});
const configPath = ref<string | undefined>(undefined);
const status = ref<ServiceStatus | null>(null);
const providers = ref<ProviderInfo[]>([]);
const agentStatuses = ref<AgentStatus[]>([]);
const saving = ref(false);
const saved = ref(false);
const loading = ref(true);
const error = ref('');
const providerData = ref<Record<string, Record<string, unknown>>>({});
const agentEnvDrafts = ref<Record<string, string>>({});
const collapsed = ref<Record<string, boolean>>({
  gateway: false,
  general: false,
  agents: false,
  providers: false,
  config: false,
});
const providerCollapsed = ref<Record<string, boolean>>({});

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

function getProviderField(name: string, key: string): unknown {
  return providerData.value[name]?.[key];
}

function setProviderField(name: string, key: string, value: unknown) {
  if (!providerData.value[name]) {
    providerData.value[name] = {};
  }
  providerData.value[name][key] = value;
}

function toggleSection(key: string) {
  collapsed.value[key] = !collapsed.value[key];
}

function toggleProvider(name: string) {
  providerCollapsed.value[name] = !providerCollapsed.value[name];
}

async function fetchAll() {
  loading.value = true;
  error.value = '';
  try {
    const [statusRes, configRes, providersRes, agentsRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/config'),
      fetch('/api/providers'),
      fetch('/api/agents'),
    ]);
    status.value = (await statusRes.json()) as ServiceStatus;
    const configData = (await configRes.json()) as { config: LegionConfig; configPath?: string };
    config.value = configData.config ?? {};
    configPath.value = configData.configPath;
    providers.value = ((await providersRes.json()) as { providers: ProviderInfo[] }).providers;
    agentStatuses.value = ((await agentsRes.json()) as { agents: AgentStatus[] }).agents;

    // Seed provider data from current config.
    for (const p of providers.value) {
      const existing = configData.config?.[p.name];
      providerData.value[p.name] =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      providerCollapsed.value[p.name] = !p.configured;
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
    const data = providerData.value[p.name] ?? {};
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === '' || v === undefined || v === null) continue;
      cleaned[k] = v;
    }
    if (Object.keys(cleaned).length > 0) {
      payload[p.name] = cleaned;
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
      <button class="refresh-btn" :disabled="loading" @click="fetchAll">
        <span class="btn-icon">↻</span> Refresh
      </button>
    </div>

    <div v-if="loading" class="loading">Loading configuration...</div>
    <div v-else-if="error" class="error-card">{{ error }}</div>

    <div v-else class="sections">
      <!-- Gateway -->
      <section class="section">
        <button class="section-header" @click="toggleSection('gateway')">
          <span class="section-icon">🖥️</span>
          <span class="section-title">Gateway</span>
          <span class="section-subtitle">{{ status?.mode ?? 'unknown' }} mode</span>
          <span class="chevron" :class="{ expanded: !collapsed.gateway }">▶</span>
        </button>
        <div class="section-body" :class="{ collapsed: collapsed.gateway }">
          <div class="card-content">
            <div class="status-grid">
              <div class="status-item">
                <span class="status-label">Version</span>
                <span class="status-value mono">{{ status?.version ?? 'unknown' }}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Install mode</span>
                <span class="badge">{{ status?.mode ?? 'unknown' }}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Service name</span>
                <span class="status-value mono">{{ status?.serviceName ?? '—' }}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Loaded</span>
                <span :class="status?.loaded ? 'ok' : 'warn'">{{
                  status?.loaded ? 'Yes' : 'No'
                }}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Active</span>
                <span :class="statusClass(status?.active)">{{ status?.active ?? 'unknown' }}</span>
              </div>
              <div class="status-item">
                <span class="status-label">Enabled</span>
                <span :class="status?.enabled ? 'ok' : 'warn'">{{
                  status?.enabled ? 'Yes' : 'No'
                }}</span>
              </div>
              <div v-if="status?.unitPath" class="status-item full-width">
                <span class="status-label">Unit path</span>
                <span class="status-value mono path" :title="status.unitPath">{{
                  status.unitPath
                }}</span>
              </div>
            </div>
            <div class="actions">
              <button class="btn secondary" @click="action('start')">Start</button>
              <button class="btn secondary" @click="action('stop')">Stop</button>
              <button class="btn secondary" @click="action('restart')">Restart</button>
            </div>
          </div>
        </div>
      </section>

      <!-- General -->
      <section class="section">
        <button class="section-header" @click="toggleSection('general')">
          <span class="section-icon">⚙️</span>
          <span class="section-title">General</span>
          <span class="section-subtitle">Default agent and storage</span>
          <span class="chevron" :class="{ expanded: !collapsed.general }">▶</span>
        </button>
        <div class="section-body" :class="{ collapsed: collapsed.general }">
          <div class="card-content">
            <div class="form-field">
              <label>Default Agent</label>
              <input v-model="defaultAgent" type="text" placeholder="e.g. kimi-code" />
            </div>
            <div class="form-field">
              <label>State Store Path</label>
              <input v-model="stateStorePath" type="text" placeholder="~/.legion/state.json" />
            </div>
          </div>
        </div>
      </section>

      <!-- Agents -->
      <section class="section">
        <button class="section-header" @click="toggleSection('agents')">
          <span class="section-icon">🤖</span>
          <span class="section-title">Agents</span>
          <span class="section-subtitle">{{ agentStatuses.length }} registered</span>
          <span class="chevron" :class="{ expanded: !collapsed.agents }">▶</span>
        </button>
        <div class="section-body" :class="{ collapsed: collapsed.agents }">
          <div class="card-content">
            <div v-if="agentStatuses.length > 0" class="agent-status-list">
              <div v-for="a in agentStatuses" :key="a.name" class="agent-status-row">
                <span class="agent-status-name">{{ a.name }}</span>
                <span class="badge" :class="a.configured ? 'ok' : 'warn'">
                  {{ a.configured ? 'configured' : 'not configured' }}
                </span>
                <span class="agent-status-summary">{{ a.summary }}</span>
              </div>
            </div>

            <div class="section-actions">
              <button class="btn small" @click="addAgent">+ Add Custom Agent</button>
            </div>
            <div v-if="Object.keys(agents).length === 0" class="empty">
              No custom agents configured.
            </div>
            <div v-for="(entry, name) in agents" :key="name" class="agent-card">
              <div class="agent-header">
                <input
                  :value="name"
                  type="text"
                  class="agent-name-input"
                  @change="updateAgentName(name, ($event.target as HTMLInputElement).value)"
                />
                <button class="btn danger small" @click="removeAgent(name)">Remove</button>
              </div>
              <div class="form-field">
                <label>Binary</label>
                <input
                  :value="(entry as AgentConfig).binary ?? ''"
                  type="text"
                  placeholder="optional binary path"
                  @input="updateAgentBinary(name, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="form-field">
                <label>Environment (KEY=VALUE per line)</label>
                <textarea v-model="agentEnvDrafts[name]" rows="3" placeholder="API_KEY=xxx" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- IM Providers -->
      <section class="section">
        <button class="section-header" @click="toggleSection('providers')">
          <span class="section-icon">🔌</span>
          <span class="section-title">IM Providers</span>
          <span class="section-subtitle">{{ providers.length }} available</span>
          <span class="chevron" :class="{ expanded: !collapsed.providers }">▶</span>
        </button>
        <div class="section-body" :class="{ collapsed: collapsed.providers }">
          <div class="card-content">
            <div v-for="p in providers" :key="p.name" class="provider-card">
              <button class="provider-header" @click="toggleProvider(p.name)">
                <span class="provider-icon">{{ PROVIDER_ICONS[p.name] ?? '🔌' }}</span>
                <span class="provider-name">{{ p.name }}</span>
                <span class="badge" :class="p.configured ? 'ok' : 'warn'">
                  {{ p.configured ? 'configured' : 'not configured' }}
                </span>
                <span class="provider-summary">{{ p.summary }}</span>
                <span class="chevron" :class="{ expanded: !providerCollapsed[p.name] }">▶</span>
              </button>
              <div class="provider-body" :class="{ collapsed: providerCollapsed[p.name] }">
                <div class="provider-form">
                  <template v-if="PROVIDER_FIELDS[p.name]">
                    <div
                      v-for="field in PROVIDER_FIELDS[p.name]"
                      :key="field.key"
                      class="form-field"
                    >
                      <label>{{ field.label }}</label>
                      <select
                        v-if="field.type === 'select'"
                        :value="getProviderField(p.name, field.key) ?? ''"
                        @change="
                          setProviderField(
                            p.name,
                            field.key,
                            ($event.target as HTMLSelectElement).value || undefined
                          )
                        "
                      >
                        <option value="">—</option>
                        <option v-for="opt in field.options" :key="opt" :value="opt">
                          {{ opt }}
                        </option>
                      </select>
                      <input
                        v-else-if="field.type === 'number'"
                        type="number"
                        :value="getProviderField(p.name, field.key) ?? ''"
                        :placeholder="field.placeholder"
                        @input="
                          setProviderField(
                            p.name,
                            field.key,
                            Number(($event.target as HTMLInputElement).value) || undefined
                          )
                        "
                      />
                      <input
                        v-else
                        :type="field.type"
                        :value="getProviderField(p.name, field.key) ?? ''"
                        :placeholder="field.placeholder"
                        @input="
                          setProviderField(
                            p.name,
                            field.key,
                            ($event.target as HTMLInputElement).value || undefined
                          )
                        "
                      />
                    </div>
                  </template>
                  <div v-else class="form-field">
                    <label>Raw JSON</label>
                    <textarea
                      :value="JSON.stringify(providerData[p.name] ?? {}, null, 2)"
                      rows="6"
                      class="code"
                      spellcheck="false"
                      @input="
                        try {
                          providerData[p.name] = JSON.parse(
                            ($event.target as HTMLTextAreaElement).value
                          );
                        } catch {
                          // keep raw text for invalid JSON
                        }
                      "
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Configuration file -->
      <section class="section">
        <button class="section-header" @click="toggleSection('config')">
          <span class="section-icon">📄</span>
          <span class="section-title">Configuration file</span>
          <span class="section-subtitle mono">{{ configPath ?? 'unknown' }}</span>
          <span class="chevron" :class="{ expanded: !collapsed.config }">▶</span>
        </button>
        <div class="section-body" :class="{ collapsed: collapsed.config }">
          <div class="card-content">
            <pre class="raw-config">{{ rawConfig }}</pre>
          </div>
        </div>
      </section>
    </div>

    <!-- Sticky save bar -->
    <div class="save-bar">
      <div v-if="saved" class="saved">Saved successfully.</div>
      <button class="btn primary" :disabled="saving" @click="save">
        {{ saving ? 'Saving...' : 'Save Changes' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 900px;
  box-sizing: border-box;
  padding-bottom: 80px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

h1 {
  margin: 0;
  color: #e6edf3;
  font-size: 24px;
  font-weight: 600;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #21262d;
  color: #c9d1d9;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 13px;
}

.refresh-btn:hover:not(:disabled) {
  background: #30363d;
  border-color: #3d444d;
}

.loading {
  color: #8b949e;
  font-size: 14px;
}

.error-card {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid rgba(248, 81, 73, 0.3);
  color: #f85149;
  padding: 14px;
  border-radius: 10px;
  margin-bottom: 16px;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.section:hover {
  border-color: #3d444d;
}

.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: transparent;
  border: none;
  color: #e6edf3;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.section-header:hover {
  background: #1c2128;
}

.section-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  flex-shrink: 0;
}

.section-subtitle {
  font-size: 12px;
  color: #8b949e;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}

.chevron {
  font-size: 10px;
  color: #8b949e;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.chevron.expanded {
  transform: rotate(90deg);
}

.section-body {
  max-height: 2000px;
  overflow: hidden;
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease;
  opacity: 1;
}

.section-body.collapsed {
  max-height: 0;
  opacity: 0;
}

.card-content {
  padding: 0 20px 20px;
  border-top: 1px solid #21262d;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-item.full-width {
  grid-column: 1 / -1;
}

.status-label {
  font-size: 12px;
  color: #8b949e;
}

.status-value {
  font-size: 14px;
  color: #c9d1d9;
}

.status-value.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.badge {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 12px;
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
}

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: #1f6feb;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: #388bfd;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.secondary {
  background: #21262d;
  border-color: #30363d;
  color: #c9d1d9;
}

.btn.secondary:hover:not(:disabled) {
  background: #30363d;
  border-color: #3d444d;
}

.btn.primary {
  background: #238636;
  font-weight: 600;
  padding: 10px 24px;
}

.btn.primary:hover:not(:disabled) {
  background: #2ea043;
}

.btn.danger {
  background: #da3633;
}

.btn.danger:hover:not(:disabled) {
  background: #f85149;
}

.btn.small {
  padding: 5px 12px;
  font-size: 12px;
}

.section-actions {
  margin-top: 16px;
  margin-bottom: 16px;
}

.agent-status-list {
  margin-bottom: 16px;
}

.agent-status-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #21262d;
}

.agent-status-row:last-child {
  border-bottom: none;
}

.agent-status-name {
  font-weight: 600;
  font-size: 14px;
  color: #e6edf3;
  min-width: 100px;
}

.agent-status-summary {
  font-size: 12px;
  color: #8b949e;
  margin-left: auto;
}

.empty {
  color: #8b949e;
  font-size: 13px;
  padding: 8px 0;
}

.form-field {
  margin-bottom: 14px;
}

.form-field:last-child {
  margin-bottom: 0;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  color: #8b949e;
  font-size: 12px;
  font-weight: 500;
}

input,
textarea,
select {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}

input:focus,
textarea:focus,
select:focus {
  border-color: #1f6feb;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.15);
}

.agent-card {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.agent-name-input {
  flex: 1;
  font-weight: 600;
  background: transparent;
  border-color: transparent;
  padding: 4px 8px;
}

.agent-name-input:hover {
  border-color: #30363d;
}

.agent-name-input:focus {
  border-color: #1f6feb;
  background: #0d1117;
}

.provider-card {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  margin-bottom: 10px;
  overflow: hidden;
}

.provider-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: transparent;
  border: none;
  color: #e6edf3;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.provider-header:hover {
  background: #161b22;
}

.provider-icon {
  font-size: 16px;
}

.provider-name {
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.provider-summary {
  font-size: 12px;
  color: #8b949e;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 30%;
}

.provider-body {
  max-height: 1000px;
  overflow: hidden;
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease;
  opacity: 1;
}

.provider-body.collapsed {
  max-height: 0;
  opacity: 0;
}

.provider-form {
  padding: 0 16px 16px;
  border-top: 1px solid #21262d;
}

.raw-config {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  color: #c9d1d9;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.save-bar {
  position: fixed;
  bottom: 0;
  left: 280px;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 16px 24px;
  background: rgba(13, 17, 23, 0.95);
  border-top: 1px solid #30363d;
  backdrop-filter: blur(8px);
  z-index: 10;
}

.saved {
  color: #3fb950;
  font-size: 14px;
}

@media (max-width: 768px) {
  .save-bar {
    left: 0;
  }
  .settings-view {
    padding-bottom: 90px;
  }
}
</style>
