// src/core/logger.ts
// 分级日志服务：控制台 + 文件输出，支持 scope 前缀。

import type { Environment, LogLevel, Logger } from './types';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',   // 灰
  info: '\x1b[36m',    // 青
  warn: '\x1b[33m',    // 黄
  error: '\x1b[31m',   // 红
  fatal: '\x1b[35m',   // 紫
};
const RESET = '\x1b[0m';

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
}

class LoggerImpl implements Logger {
  private level: LogLevel;
  private readonly scope: string;
  private readonly env: Environment;
  private readonly fileWriter: (entry: LogEntry) => void;
  private readonly colorize: boolean;

  constructor(
    env: Environment,
    scope: string,
    level: LogLevel,
    fileWriter: (entry: LogEntry) => void,
    colorize: boolean,
  ) {
    this.env = env;
    this.scope = scope;
    this.level = level;
    this.fileWriter = fileWriter;
    this.colorize = colorize;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  child(scope: string): Logger {
    // 子 scope 用 '/' 分层
    return new LoggerImpl(
      this.env,
      this.scope ? `${this.scope}/${scope}` : scope,
      this.level,
      this.fileWriter,
      this.colorize,
    );
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      context,
    };
    this.writeConsole(entry);
    this.fileWriter(entry);
  }

  private writeConsole(entry: LogEntry): void {
    const color = this.colorize ? LEVEL_COLORS[entry.level] : '';
    const reset = this.colorize ? RESET : '';
    const scopeStr = entry.scope ? `[${entry.scope}]` : '';
    const ctxStr = entry.context ? ' ' + JSON.stringify(entry.context) : '';
    const line = `${color}${entry.ts}${reset} ${color}${entry.level.toUpperCase().padEnd(5)}${reset} ${scopeStr} ${entry.message}${ctxStr}`;
    // eslint-disable-next-line no-console
    if (entry.level === 'error' || entry.level === 'fatal') {
      console.error(line);
    } else if (entry.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }
  fatal(message: string, context?: Record<string, unknown>): void {
    this.write('fatal', message, context);
  }
}

/**
 * 创建根日志器。
 * 在 Bun 环境下使用 Bun.write 追加到文件。
 */
export function createRootLogger(
  env: Environment,
  initialLevel: LogLevel = 'info',
): Logger {
  // 确保日志目录存在
  ensureDir(env.logsDir);

  const logFile = `${env.logsDir}/moss-${new Date().toISOString().slice(0, 10)}.log`;
  const colorize = env.isWindows ? process.stdout.isTTY ?? false : true;

  const fileWriter = (entry: LogEntry) => {
    const line =
      `${entry.ts} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}` +
      (entry.context ? ' ' + JSON.stringify(entry.context) : '') +
      '\n';
    // Bun.write 追加模式（'a'）
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BunAny = Bun as any;
      BunAny.write(BunAny.file(logFile, { create: true }), line).catch(() => {
        // 文件写入失败静默处理，避免日志循环
      });
    } catch {
      // 静默
    }
  };

  return new LoggerImpl(env, '', initialLevel, fileWriter, colorize);
}

function ensureDir(dir: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fs = (Bun as any).fs ?? null;
    if (fs && fs.mkdirSync) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
  } catch {
    // 回退到 node:fs
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs');
    nodeFs.mkdirSync(dir, { recursive: true });
  } catch {
    // 静默
  }
}
