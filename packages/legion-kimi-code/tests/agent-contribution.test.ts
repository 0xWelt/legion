import { DefaultAgentRunnerFactory } from 'legion';
import { describe, expect, it } from 'vitest';
import { kimiCodeAgentContribution, KimiCodeRunner, KimiCodeTextRunner } from '../src/index.js';

describe('kimiCodeAgentContribution', () => {
  it('registers both runners into the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    kimiCodeAgentContribution.register(factory);

    expect(factory.list()).toContain('kimi-code');
    expect(factory.list()).toContain('kimi-code-text');
  });

  it('creates the correct runner instances from the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    kimiCodeAgentContribution.register(factory);

    const codeRunner = factory.create('kimi-code', { binary: 'kimi' });
    const textRunner = factory.create('kimi-code-text', { binary: 'kimi' });

    expect(codeRunner).toBeInstanceOf(KimiCodeRunner);
    expect(textRunner).toBeInstanceOf(KimiCodeTextRunner);
  });
});
