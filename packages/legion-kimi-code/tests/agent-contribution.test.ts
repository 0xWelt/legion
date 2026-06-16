import { DefaultAgentRunnerFactory } from 'legion';
import { describe, expect, it } from 'vitest';
import { kimiCodeAgentContribution, KimiCodeRunner } from '../src/index.js';

describe('kimiCodeAgentContribution', () => {
  it('registers the runner into the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    kimiCodeAgentContribution.register(factory);

    expect(factory.list()).toContain('kimi-code');
  });

  it('creates the correct runner instance from the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    kimiCodeAgentContribution.register(factory);

    const codeRunner = factory.create('kimi-code', { binary: 'kimi' });

    expect(codeRunner).toBeInstanceOf(KimiCodeRunner);
  });
});
