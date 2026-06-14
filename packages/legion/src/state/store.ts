import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LegionState, Session, Workdir } from '../core/types.js';

type LegacyLegionState = Partial<
  LegionState & {
    workspaces?: Record<string, Workdir & { workdir?: string }>;
    sessions?: Record<string, Session & { workspaceId?: string }>;
  }
>;

export interface StateStore {
  load(): Promise<LegionState>;
  save(state: LegionState): Promise<void>;
}

export interface JsonStateStoreOptions {
  path: string;
}

export class JsonStateStore implements StateStore {
  private readonly path: string;

  constructor(options: JsonStateStoreOptions) {
    this.path = this.expandHome(options.path);
  }

  async load(): Promise<LegionState> {
    try {
      const content = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(content) as LegacyLegionState;
      return this.normalize(parsed);
    } catch {
      return this.normalize({});
    }
  }

  async save(state: LegionState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2), 'utf8');
  }

  private normalize(parsed: LegacyLegionState): LegionState {
    const workdirs: Record<string, Workdir> = {};

    if (parsed.workdirs) {
      for (const [id, workdir] of Object.entries(parsed.workdirs)) {
        workdirs[id] = workdir;
      }
    } else if (parsed.workspaces) {
      for (const [id, workspace] of Object.entries(parsed.workspaces)) {
        workdirs[id] = {
          ...workspace,
          path: workspace.path ?? workspace.workdir ?? '',
        };
      }
    }

    const sessions: Record<string, Session> = {};

    if (parsed.sessions) {
      for (const [id, session] of Object.entries(parsed.sessions)) {
        sessions[id] = {
          ...session,
          workdirId: session.workdirId ?? session.workspaceId ?? '',
        };
      }
    }

    return {
      workdirs,
      sessions,
    };
  }

  private expandHome(path: string): string {
    if (path.startsWith('~/')) {
      return join(homedir(), path.slice(2));
    }
    return path;
  }
}
