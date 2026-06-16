import type { AgentEvent } from '../core/types.js';

export type OutputSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolId: string; output: string }
  | { type: 'error'; message: string };

export interface AccumulatedOutput {
  segments: OutputSegment[];
}

export interface PlainTextRendererOptions {
  /** Optional resolver to turn tool IDs into display names. */
  resolveToolName?: (toolId: string) => string;
}

export function createAccumulatedOutput(): AccumulatedOutput {
  return { segments: [] };
}

/**
 * Applies a single AgentEvent to the accumulated output.
 *
 * - `text`/`thinking` with `delta` are appended to the latest segment of the
 *   same type, preserving spaces between tokens.
 * - `text`/`thinking` without `delta` replace the latest segment of the same
 *   type (useful for non-streaming runners).
 * - `tool_call`, `tool_result`, and `error` always create a new segment so
 *   their order relative to text/thinking is preserved.
 */
export function applyAgentEvent(output: AccumulatedOutput, event: AgentEvent): void {
  const segments = output.segments;

  switch (event.type) {
    case 'text': {
      if (event.delta !== undefined) {
        if (!event.delta) break;
        const last = segments[segments.length - 1];
        if (last?.type === 'text') {
          last.content += event.delta;
        } else {
          segments.push({ type: 'text', content: event.delta });
        }
      } else if (event.text.trim()) {
        const last = segments[segments.length - 1];
        if (last?.type === 'text') {
          last.content = event.text.trim();
        } else {
          segments.push({ type: 'text', content: event.text.trim() });
        }
      }
      break;
    }
    case 'thinking': {
      if (event.delta !== undefined) {
        if (!event.delta) break;
        const last = segments[segments.length - 1];
        if (last?.type === 'thinking') {
          last.content += event.delta;
        } else {
          segments.push({ type: 'thinking', content: event.delta });
        }
      } else if (event.text.trim()) {
        const last = segments[segments.length - 1];
        if (last?.type === 'thinking') {
          last.content = event.text.trim();
        } else {
          segments.push({ type: 'thinking', content: event.text.trim() });
        }
      }
      break;
    }
    case 'tool_call': {
      const last = segments[segments.length - 1];
      if (
        last?.type === 'tool_call' &&
        last.toolId === event.toolId &&
        typeof last.input === 'string'
      ) {
        // Finalize a previously streamed partial tool call.
        last.toolName = event.toolName;
        last.input = event.input;
      } else {
        segments.push({
          type: 'tool_call',
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.input,
        });
      }
      break;
    }
    case 'tool_call_delta': {
      const last = segments[segments.length - 1];
      if (
        last?.type === 'tool_call' &&
        last.toolId === event.toolId &&
        last.toolName === event.toolName &&
        typeof last.input === 'string'
      ) {
        last.input = event.partialInput;
      } else {
        segments.push({
          type: 'tool_call',
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.partialInput,
        });
      }
      break;
    }
    case 'tool_result': {
      segments.push({ type: 'tool_result', toolId: event.toolId, output: event.output });
      break;
    }
    case 'error': {
      segments.push({ type: 'error', message: event.message });
      break;
    }
    case 'complete':
    case 'session_init':
    case 'usage':
      break;
  }
}

/**
 * Builds a plain-text representation of the accumulated output suitable for
 * text-based IM platforms like Discord.
 */
export function buildPlainTextContent(
  segments: OutputSegment[],
  options?: PlainTextRendererOptions
): string {
  const resolveToolName = options?.resolveToolName ?? ((id) => id);

  return segments
    .map((seg) => {
      switch (seg.type) {
        case 'text':
          return seg.content;
        case 'thinking':
          return `💭 ${seg.content}`;
        case 'tool_call':
          return `🔧 ${seg.toolName}`;
        case 'tool_result':
          return `✅ ${resolveToolName(seg.toolId)}\n${seg.output}`;
        case 'error':
          return `❌ ${seg.message}`;
      }
    })
    .join('\n\n')
    .trim()
    .slice(0, 2000);
}
