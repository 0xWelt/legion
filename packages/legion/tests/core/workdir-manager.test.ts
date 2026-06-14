import { describe, expect, it } from 'vitest';
import { InMemoryWorkdirManager } from '../../src/core/workdir-manager.js';

describe('InMemoryWorkdirManager', () => {
  it('returns undefined for unknown workdir', () => {
    const manager = new InMemoryWorkdirManager();
    expect(manager.get('unknown')).toBeUndefined();
  });

  it('binds and retrieves workdir with defaultAgent', () => {
    const manager = new InMemoryWorkdirManager();
    const workdir = manager.bind('123', 'repo-a', '/home/user/repo-a', 'guild-1', 'kimi-code');

    expect(workdir.id).toBe('123');
    expect(workdir.name).toBe('repo-a');
    expect(workdir.path).toBe('/home/user/repo-a');
    expect(workdir.guildId).toBe('guild-1');
    expect(workdir.defaultAgent).toBe('kimi-code');

    expect(manager.get('123')).toEqual(workdir);
  });

  it('binds workdir without defaultAgent to inherit global', () => {
    const manager = new InMemoryWorkdirManager();
    const workdir = manager.bind('123', 'repo-a', '/home/user/repo-a', 'guild-1');
    expect(workdir.defaultAgent).toBeUndefined();
  });

  it('sets workdir defaultAgent', () => {
    const manager = new InMemoryWorkdirManager();
    manager.bind('123', 'repo-a', '/home/user/repo-a', 'guild-1');
    manager.setDefaultAgent('123', 'kimi-code-text');
    expect(manager.get('123')?.defaultAgent).toBe('kimi-code-text');
  });

  it('loads initial state', () => {
    const manager = new InMemoryWorkdirManager({
      '123': {
        id: '123',
        name: 'repo-a',
        path: '/home/user/repo-a',
        defaultAgent: 'kimi-code',
        guildId: 'guild-1',
        createdAt: '2026-01-01T00:00:00Z',
      },
    });

    expect(manager.list()).toHaveLength(1);
  });
});
