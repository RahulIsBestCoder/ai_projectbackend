/**
 * LOGGER_SETTINGS — consumed by `winstonlog` (plan §10 static config module).
 */
export const LOGGER_SETTINGS = {
  app_name: 'hiresense-backend-api',
  log_path: process.env.LOG_PATH || 'logs',
  log_to_console: true,
  log_to_file: true,
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
};

export type LoggerSettings = typeof LOGGER_SETTINGS;
