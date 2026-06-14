import { describe, expect, it } from 'vitest';
import { CommandParser } from '../../src/core/command-parser.js';

describe('CommandParser', () => {
  const parser = new CommandParser();

  it('parses /workdir with path', () => {
    expect(parser.parse('/workdir /home/user/project')).toEqual({
      type: 'workdir',
      path: '/home/user/project',
    });
  });

  it('parses /workdir without path', () => {
    expect(parser.parse('/workdir')).toEqual({
      type: 'workdir',
      path: undefined,
    });
  });

  it('parses /status', () => {
    expect(parser.parse('/status')).toEqual({ type: 'status' });
  });

  it('parses /help', () => {
    expect(parser.parse('/help')).toEqual({ type: 'help' });
  });

  it('parses /agent with name', () => {
    expect(parser.parse('/agent kimi-code-text')).toEqual({
      type: 'agent',
      name: 'kimi-code-text',
      scope: 'session',
    });
  });

  it('parses /agent without name', () => {
    expect(parser.parse('/agent')).toEqual({ type: 'agent', name: undefined, scope: 'session' });
  });

  it('parses /agent --global', () => {
    expect(parser.parse('/agent --global kimi-code-text')).toEqual({
      type: 'agent',
      name: 'kimi-code-text',
      scope: 'global',
    });
  });

  it('parses /agent --workdir without name', () => {
    expect(parser.parse('/agent --workdir')).toEqual({
      type: 'agent',
      name: undefined,
      scope: 'workdir',
    });
  });

  it('returns unknown for plain prompt', () => {
    expect(parser.parse('hello world')).toEqual({ type: 'unknown' });
  });
});
