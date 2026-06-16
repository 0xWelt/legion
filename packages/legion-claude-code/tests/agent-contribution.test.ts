import { DefaultAgentRunnerFactory } from 'legion';
import { describe, expect, it } from 'vitest';
import { claudeCodeAgentContribution, ClaudeCodeRunner } from '../src/index.js';

describe('claudeCodeAgentContribution', () => {
  it('registers claude-code runner into the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    claudeCodeAgentContribution.register(factory);

    expect(factory.list()).toContain('claude-code');
  });

  it('creates the correct runner instance from the factory', () => {
    const factory = new DefaultAgentRunnerFactory();
    claudeCodeAgentContribution.register(factory);

    const runner = factory.create('claude-code', { binary: 'claude' });
    expect(runner).toBeInstanceOf(ClaudeCodeRunner);
  });
});
