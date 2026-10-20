import pino from 'pino';

export type Logger = pino.Logger;

/** Strukturierte JSON-Logs auf stdout. Keine IP-Adressen, keine Tokens, keine Passwörter. */
export function createLogger(level = 'info'): Logger {
  return pino({
    level,
    base: { app: 'filum' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
      censor: '[entfernt]',
    },
  });
}
