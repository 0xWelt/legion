export { COMMAND_DEFINITIONS } from '@0xwelt/legion-api';

export type AgentScope = 'global' | 'workdir' | 'session';

export type Command =
  | { type: 'workdir'; path?: string }
  | { type: 'agent'; name?: string; scope: AgentScope }
  | { type: 'status' }
  | { type: 'help' }
  | { type: 'unknown' };

export class CommandParser {
  parse(content: string): Command {
    const trimmed = content.trim();

    if (trimmed.startsWith('/workdir')) {
      const rest = trimmed.slice('/workdir'.length).trim();
      return { type: 'workdir', path: rest || undefined };
    }

    if (trimmed.startsWith('/agent')) {
      const tokens = trimmed.slice('/agent'.length).trim().split(/\s+/).filter(Boolean);
      let scope: AgentScope = 'session';
      let name: string | undefined;
      for (const token of tokens) {
        if (token === '--global' || token === '-g') {
          scope = 'global';
        } else if (token === '--workdir' || token === '-w') {
          scope = 'workdir';
        } else if (token === '--session' || token === '-s') {
          scope = 'session';
        } else if (!name) {
          name = token;
        }
      }
      return { type: 'agent', name, scope };
    }

    if (trimmed === '/status') {
      return { type: 'status' };
    }

    if (trimmed === '/help') {
      return { type: 'help' };
    }

    return { type: 'unknown' };
  }
}
