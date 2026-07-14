import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LegionState, Session, StateStore, JsonStateStoreOptions } from '@0xwelt/legion-api';

export type { StateStore, JsonStateStoreOptions } from '@0xwelt/legion-api';

type LegacySession = Session & {
  workspaceId?: string;
  workdirId?: string;
  type?: string;
};

type LegacyWorkdir = { path?: string; defaultAgent?: string };

export class JsonStateStore implements StateStore {
  private readonly path: string;

  constructor(options: JsonStateStoreOptions) {
    this.path = this.expandHome(options.path);
  }

  async load(): Promise<LegionState> {
    try {
      const content = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      return this.normalize(parsed);
    } catch {
      return this.normalize({});
    }
  }

  async save(state: LegionState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), 'utf8');
  }

  private normalize(parsed: unknown): LegionState {
    const legacy = parsed as {
      workspaces?: Record<string, LegacyWorkdir>;
      workdirs?: Record<string, LegacyWorkdir>;
      sessions?: Record<string, LegacySession>;
    };

    const workdirPaths = new Map<string, string>();
    if (legacy.workdirs) {
      for (const [id, workdir] of Object.entries(legacy.workdirs)) {
        workdirPaths.set(id, workdir.path ?? '');
      }
    } else if (legacy.workspaces) {
      for (const [id, workspace] of Object.entries(legacy.workspaces)) {
        workdirPaths.set(id, workspace.path ?? '');
      }
    }

    const sessions: Record<string, Session> = {};
    if (legacy.sessions) {
      for (const [id, session] of Object.entries(legacy.sessions)) {
        const workdirId = session.workdirId ?? session.workspaceId ?? '';
        const path = session.path ?? workdirPaths.get(workdirId) ?? '';
        sessions[id] = {
          ...session,
          path,
          provider: session.provider ?? inferLegacyProvider(id),
        };
      }
    }

    return { sessions };
  }

  private expandHome(path: string): string {
    if (path.startsWith('~/')) {
      return join(homedir(), path.slice(2));
    }
    return path;
  }
}

function inferLegacyProvider(id: string): string {
  if (/^\d{17,19}$/.test(id)) {
    return 'discord';
  }
  return 'legacy';
}
