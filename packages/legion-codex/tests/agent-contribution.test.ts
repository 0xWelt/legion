import { DefaultAgentRunnerFactory } from '@0xwelt/legion-api';
import { describe, expect, it } from 'vitest';
import { codexAgentContribution, CodexRunner } from '../src/index.js';

describe('codexAgentContribution', () => {
  it('registers codex runner into the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    void codexAgentContribution.register(factory);

    expect(factory.list()).toContain('codex');
  });

  it('creates the correct runner instance from the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    void codexAgentContribution.register(factory);

    const runner = factory.create('codex', { binary: 'codex' });
    expect(runner).toBeInstanceOf(CodexRunner);
  });
});
