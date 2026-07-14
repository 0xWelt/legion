import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStateStore } from '../../src/state/store.js';

describe('JsonStateStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'legion-state-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty state when file does not exist', async () => {
    const store = new JsonStateStore({ path: join(tempDir, 'missing.json') });
    const state = await store.load();
    expect(state.sessions).toEqual({});
  });

  it('saves and loads flat session state', async () => {
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    await store.save({
      sessions: {
        '1': {
          id: '1',
          provider: 'test',
          name: 'repo-a',
          path: '/tmp/repo-a',
          agent: 'kimi',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00Z',
          lastUsedAt: '2026-01-01T00:00:00Z',
        },
      },
    });

    const loaded = await store.load();
    expect(loaded.sessions['1'].path).toBe('/tmp/repo-a');
    expect(loaded.sessions['1'].agent).toBe('kimi');
  });

  it('migrates legacy workdirs into flat sessions', async () => {
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    await writeFile(
      join(tempDir, 'state.json'),
      JSON.stringify({
        workdirs: {
          '1': {
            path: '/tmp/repo-a',
            defaultAgent: 'kimi-code',
          },
        },
        sessions: {
          s1: {
            id: 's1',
            provider: 'legacy',
            name: 'main',
            workdirId: '1',
            agent: 'kimi-code',
            status: 'idle',
            createdAt: '2026-01-01T00:00:00Z',
            lastUsedAt: '2026-01-01T00:00:00Z',
          },
        },
      }),
      'utf8'
    );

    const loaded = await store.load();
    expect(loaded.sessions['s1'].path).toBe('/tmp/repo-a');
  });
});
