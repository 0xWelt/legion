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
    expect(state.workdirs).toEqual({});
    expect(state.sessions).toEqual({});
  });

  it('saves and loads state', async () => {
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    await store.save({
      workdirs: {
        '1': {
          id: '1',
          name: 'repo-a',
          path: '/tmp/repo-a',
          defaultAgent: 'kimi',
          createdAt: '2026-01-01T00:00:00Z',
        },
      },
      sessions: {},
    });

    const loaded = await store.load();
    expect(loaded.workdirs['1'].name).toBe('repo-a');
  });

  it('migrates legacy workspaces and session workspaceId on load', async () => {
    const store = new JsonStateStore({ path: join(tempDir, 'state.json') });
    await writeFile(
      join(tempDir, 'state.json'),
      JSON.stringify({
        workspaces: {
          '1': {
            id: '1',
            name: 'repo-a',
            workdir: '/tmp/repo-a',
            defaultAgent: 'kimi-code',
            createdAt: '2026-01-01T00:00:00Z',
          },
        },
        sessions: {
          s1: {
            id: 's1',
            name: 'main',
            workspaceId: '1',
            type: 'main',
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
    expect(loaded.workdirs['1'].path).toBe('/tmp/repo-a');
    expect(loaded.sessions['s1'].workdirId).toBe('1');
  });
});
