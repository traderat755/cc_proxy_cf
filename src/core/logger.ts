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

  private logToConsole(level: string, message: string): void {
    const formattedMessage = this.formatMessage(level, message);
    
    // 在 Cloudflare Workers 和 Node.js 环境中都确保日志输出
    if (typeof console !== 'undefined') {
      switch (level) {
        case 'DEBUG':
          console.log(formattedMessage);
          break;
        case 'INFO':
          console.log(formattedMessage);
          break;
        case 'WARN':
          console.warn(formattedMessage);
          break;
        case 'ERROR':
          console.error(formattedMessage);
          break;
        default:
          console.log(formattedMessage);
      }
    }
    
    // 在 Cloudflare Workers 环境中，也尝试使用 console.log
    if (typeof globalThis !== 'undefined' && (globalThis as any).console) {
      try {
        (globalThis as any).console.log(formattedMessage);
      } catch (e) {
        // 忽略错误，继续执行
      }
    }
  }

  debug(message: string): void {
    if (this.shouldLog('DEBUG')) {
      this.logToConsole('DEBUG', message);
    }
  }

  info(message: string): void {
    if (this.shouldLog('INFO')) {
      this.logToConsole('INFO', message);
    }
  }

  warn(message: string): void {
    if (this.shouldLog('WARN')) {
      this.logToConsole('WARN', message);
    }
  }

  error(message: string): void {
    if (this.shouldLog('ERROR')) {
      this.logToConsole('ERROR', message);
    }
  }
}

// 获取日志级别，优先使用环境变量，默认为 DEBUG 以确保能看到所有日志
function getLogLevel(): string {
  // 尝试从多个来源获取日志级别
  if (typeof globalThis !== 'undefined' && (globalThis as any).process && (globalThis as any).process.env) {
    return (globalThis as any).process.env.LOG_LEVEL || 'DEBUG';
  }
  
  // 在 Cloudflare Workers 环境中，尝试从全局配置获取
  if (typeof globalThis !== 'undefined' && (globalThis as any).CONFIG) {
    return (globalThis as any).CONFIG.logLevel || 'DEBUG';
  }
  
  return 'DEBUG';
}

export const logger = new SimpleLogger(getLogLevel());