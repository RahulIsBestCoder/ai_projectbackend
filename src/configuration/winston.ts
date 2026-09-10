import fs from 'fs';
import winston from 'winston';
import 'winston-daily-rotate-file';
import { LoggerSettings } from './log_config';

/**
 * `winstonlog` — thin wrapper around winston (plan §1 logging, §5.4 `writelog`).
 * Exposes `logger` (used as a morgan stream) and `writelog(method, msg, severity)`
 * called at the top of every controller / service method.
 */
export class winstonlog {
  public logger: winston.Logger;

  constructor(settings: LoggerSettings) {
    const dir = settings.log_path || 'logs';
    if (settings.log_to_file && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const transports: winston.transport[] = [];
    if (settings.log_to_console) {
      transports.push(new winston.transports.Console());
    }
    if (settings.log_to_file) {
      transports.push(
        new (winston.transports as any).DailyRotateFile({
          dirname: dir,
          filename: 'app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          zippedArchive: false,
        }),
      );
    }

    this.logger = winston.createLogger({
      level: settings.level || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf((info) => `${info.timestamp} [${String(info.level).toUpperCase()}] ${info.message}`),
      ),
      transports,
    });
  }

  public initiateLoggingSystem(): void {
    this.logger.info('logging system initiated');
  }

  public writelog(method: string, msg: unknown, severity = 'INFO'): void {
    let text: string;
    if (Array.isArray(msg)) {
      text = msg.map((m) => (typeof m === 'string' ? m : this.stringify(m))).join(' ');
    } else if (typeof msg === 'string') {
      text = msg;
    } else if (msg instanceof Error) {
      text = msg.stack || msg.message;
    } else {
      text = this.stringify(msg);
    }

    const sev = String(severity).toLowerCase();
    const level = sev === 'error' ? 'error' : sev === 'warn' ? 'warn' : sev === 'debug' ? 'debug' : 'info';
    this.logger.log(level, `${method} :: ${text}`);
  }

  private stringify(v: unknown): string {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
}
