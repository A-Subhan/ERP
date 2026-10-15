/* ===========================================================================
 * Backend config loader — reads .env, exposes typed config.
 * ==========================================================================*/
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: num('PORT', 4000),
  host: str('HOST', '127.0.0.1'),
  baseUrl: str('BASE_URL', 'http://localhost:4000'),
  db: {
    server: str('DB_SERVER', 'localhost'),
    port: num('DB_PORT', 1433),
    database: str('DB_DATABASE', 'erp'),
    user: str('DB_USER', 'sa'),
    password: str('DB_PASSWORD', ''),
    encrypt: bool('DB_ENCRYPT', false),
    trustServerCertificate: bool('DB_TRUST_SERVER_CERTIFICATE', true),
    requestTimeout: num('DB_REQUEST_TIMEOUT', 30000),
    poolMax: num('DB_CONNECTION_POOL_SIZE', 10),
  },
  session: {
    secret: str('SESSION_SECRET', 'change-me-32-chars-please-1234567890'),
    name: str('SESSION_NAME', 'erp.sid'),
    maxAgeHours: num('SESSION_MAX_AGE_HOURS', 12),
  },
  csrf: {
    secret: str('CSRF_SECRET', 'change-me-csrf-32-chars-please'),
  },
  security: {
    bcryptRounds: num('BCRYPT_ROUNDS', 12),
    loginRateLimitWindowMs: num('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    loginRateLimitMax: num('LOGIN_RATE_LIMIT_MAX', 10),
  },
  setupCompleted: bool('SETUP_COMPLETED', false),
};

export type Config = typeof config;
