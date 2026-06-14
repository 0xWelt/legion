import { COMMAND_DEFINITIONS, type IMCommandDefinition } from 'legion';
import { describe, expect, it } from 'vitest';
import { buildCommandContent, buildSlashCommands } from '../src/discord-slash-commands.js';

function makeInteraction(
  commandName: string,
  options: Record<string, string | null> = {}
): unknown {
  return {
    commandName,
    options: {
      getString: (name: string) => options[name] ?? null,
    },
  };
}

describe('buildSlashCommands', () => {
  it('includes all command names', () => {
    const commands = buildSlashCommands(COMMAND_DEFINITIONS);
    const names = commands.map((cmd) => cmd.name).sort();
    expect(names).toEqual(['agent', 'help', 'status', 'workdir']);
  });

  it('adds choices to options when provided', () => {
    const definitions: IMCommandDefinition[] = [
      {
        name: 'agent',
        description: 'switch runner',
        options: [
          {
            name: 'name',
            description: 'runner name',
            required: false,
            choices: ['kimi-code', 'kimi-code-text'],
          },
        ],
      },
    ];
    const commands = buildSlashCommands(definitions);
    const options = commands[0].options ?? [];
    expect(options).toHaveLength(1);
    expect((options[0] as { choices?: Array<{ name: string; value: string }> }).choices).toEqual([
      { name: 'kimi-code', value: 'kimi-code' },
      { name: 'kimi-code-text', value: 'kimi-code-text' },
    ]);
  });
});

describe('buildCommandContent', () => {
  it('builds /workdir with path', () => {
    expect(
      buildCommandContent(
        makeInteraction('workdir', { path: '/tmp/repo' }) as never,
        COMMAND_DEFINITIONS
      )
    ).toBe('/workdir /tmp/repo');
  });

  it('builds /workdir without path', () => {
    expect(buildCommandContent(makeInteraction('workdir') as never, COMMAND_DEFINITIONS)).toBe(
      '/workdir'
    );
  });

  it('builds /status', () => {
    expect(buildCommandContent(makeInteraction('status') as never, COMMAND_DEFINITIONS)).toBe(
      '/status'
    );
  });

  it('builds /agent with name', () => {
    expect(
      buildCommandContent(
        makeInteraction('agent', { name: 'kimi-code-text' }) as never,
        COMMAND_DEFINITIONS
      )
    ).toBe('/agent kimi-code-text');
  });

  it('builds /agent without name', () => {
    expect(buildCommandContent(makeInteraction('agent') as never, COMMAND_DEFINITIONS)).toBe(
      '/agent'
    );
  });

  it('builds /agent with name and scope', () => {
    expect(
      buildCommandContent(
        makeInteraction('agent', { name: 'kimi-code-text', scope: 'global' }) as never,
        COMMAND_DEFINITIONS
      )
    ).toBe('/agent kimi-code-text --global');
  });

  it('builds /help', () => {
    expect(buildCommandContent(makeInteraction('help') as never, COMMAND_DEFINITIONS)).toBe(
      '/help'
    );
  });

  it('returns null for unknown command', () => {
    expect(
      buildCommandContent(makeInteraction('unknown') as never, COMMAND_DEFINITIONS)
    ).toBeNull();
  });
});
