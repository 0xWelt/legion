import { describe, expect, it } from 'vitest';
import { applyAgentEvent, createAccumulatedOutput } from '../../src/im/event-accumulator.js';

describe('applyAgentEvent', () => {
  it('appends text deltas to a single text segment', () => {
    const output = createAccumulatedOutput();
    applyAgentEvent(output, { type: 'text', text: 'Hello', delta: 'Hello' });
    applyAgentEvent(output, { type: 'text', text: 'Hello world', delta: ' world' });
    expect(output.segments).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('creates a tool_call segment from a tool_call_delta and updates it on subsequent deltas', () => {
    const output = createAccumulatedOutput();
    applyAgentEvent(output, {
      type: 'tool_call_delta',
      toolId: 't1',
      toolName: 'bash',
      partialInput: '{"com',
      delta: '{"com',
    });
    expect(output.segments).toEqual([
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: '{"com' },
    ]);

    applyAgentEvent(output, {
      type: 'tool_call_delta',
      toolId: 't1',
      toolName: 'bash',
      partialInput: '{"command":"ls"}',
      delta: 'mand":"ls"}',
    });
    expect(output.segments).toEqual([
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: '{"command":"ls"}' },
    ]);
  });

  it('finalizes a streamed tool_call segment when the full tool_call event arrives', () => {
    const output = createAccumulatedOutput();
    applyAgentEvent(output, {
      type: 'tool_call_delta',
      toolId: 't1',
      toolName: 'bash',
      partialInput: '{"command":"ls"}',
      delta: '{"command":"ls"}',
    });
    applyAgentEvent(output, {
      type: 'tool_call',
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'ls' },
    });
    expect(output.segments).toEqual([
      { type: 'tool_call', toolId: 't1', toolName: 'bash', input: { command: 'ls' } },
    ]);
  });

  it('keeps unrelated tool_call segments separate', () => {
    const output = createAccumulatedOutput();
    applyAgentEvent(output, {
      type: 'tool_call',
      toolId: 't1',
      toolName: 'bash',
      input: { command: 'ls' },
    });
    applyAgentEvent(output, {
      type: 'tool_call_delta',
      toolId: 't2',
      toolName: 'read_file',
      partialInput: '{"path":"/tmp/a"}',
      delta: '{"path":"/tmp/a"}',
    });
    expect(output.segments).toHaveLength(2);
    expect(output.segments[1]).toMatchObject({
      type: 'tool_call',
      toolId: 't2',
      toolName: 'read_file',
      input: '{"path":"/tmp/a"}',
    });
  });
});
