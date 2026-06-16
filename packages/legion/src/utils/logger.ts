import type { Logger } from 'legion-api';

export type { Logger } from 'legion-api';

export class ConsoleLogger implements Logger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`${this.timestamp()} [INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`${this.timestamp()} [ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}
