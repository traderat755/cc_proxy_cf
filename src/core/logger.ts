interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

class SimpleLogger implements Logger {
  private level: string;

  constructor(level: string = 'INFO') {
    this.level = level.toUpperCase();
  }

  private shouldLog(messageLevel: string): boolean {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const currentLevelIndex = levels.indexOf(this.level);
    const messageLevelIndex = levels.indexOf(messageLevel);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${level}: ${message}`;
  }

  debug(message: string): void {
    if (this.shouldLog('DEBUG')) {
      console.log(this.formatMessage('DEBUG', message));
    }
  }

  info(message: string): void {
    if (this.shouldLog('INFO')) {
      console.log(this.formatMessage('INFO', message));
    }
  }

  warn(message: string): void {
    if (this.shouldLog('WARN')) {
      console.warn(this.formatMessage('WARN', message));
    }
  }

  error(message: string): void {
    if (this.shouldLog('ERROR')) {
      console.error(this.formatMessage('ERROR', message));
    }
  }
}

export const logger = new SimpleLogger(
  (typeof globalThis !== 'undefined' && (globalThis as any).process ? (globalThis as any).process.env.LOG_LEVEL : undefined) || 'INFO'
);