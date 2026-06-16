import type { AgentEvent } from 'legion-api';
import type { LarkCard } from './types.js';

const MAX_TEXT_LENGTH = 3000;
const MAX_PANEL_LENGTH = 2000;

export interface CardState {
  mainText: string;
  thinking: string;
  toolCalls: string[];
  toolResults: string[];
  hasError: boolean;
  errorMessage: string;
}

export function createInitialState(): CardState {
  return {
    mainText: '',
    thinking: '',
    toolCalls: [],
    toolResults: [],
    hasError: false,
    errorMessage: '',
  };
}

export function applyEvent(state: CardState, event: AgentEvent): CardState {
  switch (event.type) {
    case 'text': {
      state.mainText = event.text;
      break;
    }
    case 'thinking': {
      const delta = event.delta ?? event.text;
      if (delta) {
        state.thinking += delta;
      }
      break;
    }
    case 'tool_call': {
      const params = formatToolInput(event.input);
      const displayName = event.toolName === 'unknown' ? '工具调用' : event.toolName;
      state.toolCalls.push(`${displayName}\n${params}`.trim());
      break;
    }
    case 'tool_call_delta': {
      // Lark renders the finalized tool_call once JSON accumulation completes.
      break;
    }
    case 'tool_result': {
      const toolName = event.toolId;
      state.toolResults.push(`${toolName}\n${event.output}`);
      break;
    }
    case 'error': {
      state.hasError = true;
      state.errorMessage = event.message;
      break;
    }
    case 'complete':
    case 'session_init':
    case 'usage':
      break;
  }
  return state;
}

export function buildCard(state: CardState): LarkCard {
  const elements: unknown[] = [];

  if (state.hasError) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `❌ ${escapeMarkdown(state.errorMessage)}`,
      },
    });
  }

  const mainText =
    state.mainText ||
    (state.thinking.length === 0 && state.toolCalls.length === 0 ? '思考中…' : '');
  if (mainText) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: escapeMarkdown(truncate(mainText, MAX_TEXT_LENGTH)),
      },
    });
  }

  if (state.thinking.length > 0) {
    elements.push(buildCollapsiblePanel('💭 思考过程', [state.thinking], MAX_PANEL_LENGTH));
  }

  if (state.toolCalls.length > 0) {
    elements.push(buildCollapsiblePanel('🔧 工具调用', state.toolCalls, MAX_PANEL_LENGTH));
  }

  if (state.toolResults.length > 0) {
    elements.push(buildCollapsiblePanel('📤 工具结果', state.toolResults, MAX_PANEL_LENGTH));
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: state.hasError ? 'red' : 'blue',
      title: {
        tag: 'plain_text',
        content: state.hasError ? 'Agent 出错' : 'Agent 回复',
      },
    },
    elements,
  };
}

function buildCollapsiblePanel(title: string, items: string[], maxLength: number): unknown {
  const content = items
    .map((item) => escapeMarkdown(truncate(item, maxLength)))
    .join('\n\n---\n\n');
  return {
    tag: 'collapsible_panel',
    header: {
      tag: 'plain_text',
      content: title,
    },
    expanded: false,
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: content || ' ',
        },
      },
    ],
  };
}

function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input !== 'object') {
    return String(input);
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return '';
  }
  return '```json\n' + JSON.stringify(input, null, 2).slice(0, 1500) + '\n```';
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

function escapeMarkdown(text: string): string {
  return text.replace(/([*#[\]()`~_|])/g, '\\$1');
}
