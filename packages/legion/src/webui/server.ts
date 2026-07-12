import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServiceManager, ServiceStatus } from '@0xwelt/legion-api';

export interface ClientMessagePayload {
  channelId: string;
  threadId?: string;
  content: string;
  authorName?: string;
  authorId?: string;
}

export interface ClientThreadCreatePayload {
  channelId: string;
  threadId: string;
  name: string;
}

export interface ClientThreadArchivePayload {
  threadId: string;
  archived: boolean;
}

export type ServerMessage =
  | { type: 'commands'; commands: unknown[] }
  | { type: 'text'; target: unknown; text: string; messageId: string }
  | { type: 'edit-text'; ref: unknown; text: string }
  | { type: 'embed'; target: unknown; embed: unknown; messageId: string }
  | { type: 'edit-embed'; ref: unknown; embed: unknown }
  | { type: 'typing' }
  | { type: 'agent-event'; target: unknown; event: unknown };

type MessageHandler = (payload: ClientMessagePayload) => void;
type ThreadCreateHandler = (payload: ClientThreadCreatePayload) => void;
type ThreadDeleteHandler = (threadId: string) => void;
type ThreadArchiveHandler = (payload: ClientThreadArchivePayload) => void;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

function parseState(data: unknown): { workdirs: unknown[]; sessions: unknown[] } {
  const state = data as {
    workdirs?: Record<string, unknown> | unknown[];
    sessions?: Record<string, unknown> | unknown[];
  };
  return {
    workdirs: Array.isArray(state.workdirs) ? state.workdirs : Object.values(state.workdirs ?? {}),
    sessions: Array.isArray(state.sessions) ? state.sessions : Object.values(state.sessions ?? {}),
  };
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

export interface ServerOptions {
  authToken?: string;
  serviceManager?: ServiceManager;
  stateStorePath?: string;
  loadConfig?: () => Promise<unknown>;
  saveConfig?: (config: Record<string, unknown>) => Promise<void>;
}

export class WebUIServer {
  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private sockets = new Set<WebSocket>();
  private messageHandler?: MessageHandler;
  private threadCreateHandler?: ThreadCreateHandler;
  private threadDeleteHandler?: ThreadDeleteHandler;
  private threadArchiveHandler?: ThreadArchiveHandler;

  constructor(private readonly options: ServerOptions = {}) {}

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onThreadCreate(handler: ThreadCreateHandler): void {
    this.threadCreateHandler = handler;
  }

  onThreadDelete(handler: ThreadDeleteHandler): void {
    this.threadDeleteHandler = handler;
  }

  onThreadArchive(handler: ThreadArchiveHandler): void {
    this.threadArchiveHandler = handler;
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  private checkAuth(req: IncomingMessage): boolean {
    if (!this.options.authToken) return true;
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token =
      url.searchParams.get('token') ?? req.headers.authorization?.replace('Bearer ', '');
    return token === this.options.authToken;
  }

  async start(host: string, port: number, staticRoot?: string): Promise<void> {
    this.httpServer = createServer(async (req, res) => {
      if (!this.checkAuth(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const state = await this.readState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        const config = await this.readConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/config') {
        const body = await parseJsonBody(req);
        await this.writeConfig(body as Record<string, unknown>);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        const status = await this.getServiceStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/service/')) {
        const action = url.pathname.slice('/api/service/'.length);
        await this.handleServiceAction(action);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (staticRoot) {
        const filePath =
          url.pathname === '/'
            ? resolve(staticRoot, 'index.html')
            : resolve(staticRoot, url.pathname.slice(1));

        try {
          const data = await readFile(filePath);
          const ext = extname(filePath);
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
          res.end(data);
          return;
        } catch {
          try {
            const data = await readFile(resolve(staticRoot, 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
            return;
          } catch {
            // fall through to 404
          }
        }
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      if (!this.checkAuth(req)) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      this.sockets.add(ws);
      ws.on('close', () => this.sockets.delete(ws));
      ws.on('message', (raw) => {
        try {
          const data = Buffer.isBuffer(raw)
            ? raw
            : Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.from(raw as ArrayBuffer);
          const msg = JSON.parse(data.toString()) as unknown;
          this.handleClientMessage(msg, ws);
        } catch {
          // ignore invalid messages
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, host, () => {
        console.log(`Legion Web UI listening on http://${host}:${port}`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  private async readState(): Promise<{ workdirs: unknown[]; sessions: unknown[] }> {
    if (!this.options.stateStorePath) return { workdirs: [], sessions: [] };
    try {
      const data = await readFile(expandHome(this.options.stateStorePath), 'utf8');
      return parseState(JSON.parse(data));
    } catch {
      return { workdirs: [], sessions: [] };
    }
  }

  private async readConfig(): Promise<unknown> {
    if (this.options.loadConfig) {
      return this.options.loadConfig();
    }
    return {};
  }

  private async writeConfig(config: Record<string, unknown>): Promise<void> {
    if (this.options.saveConfig) {
      await this.options.saveConfig(config);
    }
  }

  private async getServiceStatus(): Promise<ServiceStatus> {
    if (!this.options.serviceManager) {
      return { loaded: false };
    }
    return this.options.serviceManager.status();
  }

  private async handleServiceAction(action: string): Promise<void> {
    if (!this.options.serviceManager) return;
    switch (action) {
      case 'start':
        await this.options.serviceManager.start();
        break;
      case 'stop':
        await this.options.serviceManager.stop();
        break;
      case 'restart':
        await this.options.serviceManager.restart();
        break;
    }
  }

  private handleClientMessage(msg: unknown, _ws: WebSocket): void {
    if (typeof msg !== 'object' || msg === null) return;
    const data = msg as Record<string, unknown>;

    if (
      data.type === 'message' &&
      typeof data.channelId === 'string' &&
      typeof data.content === 'string'
    ) {
      this.messageHandler?.({
        channelId: data.channelId,
        threadId: typeof data.threadId === 'string' ? data.threadId : undefined,
        content: data.content,
        authorName: typeof data.authorName === 'string' ? data.authorName : undefined,
        authorId: typeof data.authorId === 'string' ? data.authorId : undefined,
      });
    }

    if (
      data.type === 'thread-create' &&
      typeof data.channelId === 'string' &&
      typeof data.threadId === 'string' &&
      typeof data.name === 'string'
    ) {
      this.threadCreateHandler?.({
        channelId: data.channelId,
        threadId: data.threadId,
        name: data.name,
      });
    }

    if (data.type === 'thread-delete' && typeof data.threadId === 'string') {
      this.threadDeleteHandler?.(data.threadId);
    }

    if (
      data.type === 'thread-archive' &&
      typeof data.threadId === 'string' &&
      typeof data.archived === 'boolean'
    ) {
      this.threadArchiveHandler?.({ threadId: data.threadId, archived: data.archived });
    }
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const ws of this.sockets) {
        ws.close();
      }
      this.sockets.clear();
      this.httpServer?.close(() => resolve());
    });
  }
}
