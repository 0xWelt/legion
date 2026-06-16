import type { LegionState } from '../core/types.js';

export interface StateStore {
  load(): Promise<LegionState>;
  save(state: LegionState): Promise<void>;
}

export interface JsonStateStoreOptions {
  path: string;
}
