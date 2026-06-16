import type { Workdir } from './types.js';

export interface WorkdirManager {
  get(id: string): Workdir | undefined;
  bind(workdirId: string, name: string, path: string, defaultAgent?: string): Workdir;
  setDefaultAgent(workdirId: string, defaultAgent: string): void;
  list(): Workdir[];
}

export class InMemoryWorkdirManager implements WorkdirManager {
  private workdirs: Map<string, Workdir> = new Map();

  constructor(initial: Record<string, Workdir> = {}) {
    for (const [id, workdir] of Object.entries(initial)) {
      this.workdirs.set(id, workdir);
    }
  }

  get(id: string): Workdir | undefined {
    return this.workdirs.get(id);
  }

  bind(workdirId: string, name: string, path: string, defaultAgent?: string): Workdir {
    const workdir: Workdir = {
      id: workdirId,
      name,
      path,
      defaultAgent,
      createdAt: new Date().toISOString(),
    };
    this.workdirs.set(workdirId, workdir);
    return workdir;
  }

  setDefaultAgent(workdirId: string, defaultAgent: string): void {
    const workdir = this.workdirs.get(workdirId);
    if (workdir) {
      workdir.defaultAgent = defaultAgent;
    }
  }

  list(): Workdir[] {
    return Array.from(this.workdirs.values());
  }

  load(state: Record<string, Workdir>): void {
    this.workdirs = new Map(Object.entries(state));
  }

  dump(): Record<string, Workdir> {
    return Object.fromEntries(this.workdirs);
  }
}
