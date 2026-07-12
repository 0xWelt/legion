<script setup lang="ts">
import { ref, onMounted } from 'vue';

const config = ref<Record<string, unknown>>({});
const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  const res = await fetch('/api/config');
  if (res.ok) {
    config.value = (await res.json()) as Record<string, unknown>;
  }
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value),
    });
    saved.value = res.ok;
  } finally {
    saving.value = false;
  }
}

function update(key: string, value: string) {
  config.value = { ...config.value, [key]: value };
}
</script>

<template>
  <div class="settings-view">
    <h1>Settings</h1>
    <div class="card">
      <label>
        Default Agent
        <input
          :value="(config.defaultAgent as string) ?? ''"
          type="text"
          @input="update('defaultAgent', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label>
        State Store Path
        <input
          :value="((config.stateStore as Record<string, string>)?.path as string) ?? ''"
          type="text"
          @input="
            config = {
              ...config,
              stateStore: { path: ($event.target as HTMLInputElement).value },
            }
          "
        />
      </label>

      <div v-if="saved" class="saved">Saved.</div>
      <button :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save' }}</button>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
}
h1 {
  margin-top: 0;
  color: #e6edf3;
  font-size: 22px;
}
.card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  max-width: 480px;
}
label {
  display: block;
  margin-bottom: 16px;
  color: #c9d1d9;
}
input {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
  outline: none;
}
input:focus {
  border-color: #1f6feb;
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.2);
}
button {
  padding: 8px 18px;
  border-radius: 6px;
  border: none;
  background: #1f6feb;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
}
button:hover:not(:disabled) {
  background: #388bfd;
}
.saved {
  color: #3fb950;
  margin-bottom: 12px;
}
</style>
