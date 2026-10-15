/* ===========================================================================
 * Pino logger — structured JSON logs in prod, pretty logs in dev.
 * ==========================================================================*/
import pino from 'pino';
import { config } from '../config';

const isProd = config.env === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  transport: isProd ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash'],
    censor: '[redacted]',
  },
});
