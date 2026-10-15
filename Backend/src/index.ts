/* ===========================================================================
 * ERP Backend — application entry
 * Express 4 + session + CSRF + helmet + rate-limit + pino + mssql
 * ==========================================================================*/
import path from 'path';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { getPool } from './db/pool';
import { sessionLoader } from './middleware/sessionLoader';
import { csrfMiddleware } from './middleware/csrf';
import { errorHandler, notFound } from './middleware/error';
import { authRouter } from './routes/auth.routes';
import { branchRouter } from './routes/branch.routes';
import { unitRouter } from './routes/unit.routes';
import { accountRouter } from './routes/account.routes';
import { userRouter } from './routes/user.routes';

async function bootstrap(): Promise<void> {
  // Verify DB connectivity up front
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT 1 AS ok');
    if (r.recordset[0].ok !== 1) throw new Error('unexpected');
    logger.info('SQL Server connected');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'SQL Server connection failed on startup');
    logger.error('Check DB_SERVER, DB_PORT, DB_DATABASE, DB_USER, DB_PASSWORD in Backend/.env and that the SQL Server instance is running.');
    process.exit(1);
  }

  const app = express();

  // Behind IIS reverse proxy: trust the first hop for X-Forwarded-*
  app.set('trust proxy', 1);

  // Security
  app.use(helmet({
    contentSecurityPolicy: false, // overridden below
    crossOriginEmbedderPolicy: false,
  }));

  // Build outputs served from Frontend/dist when NODE_ENV=production
  const frontendDist = path.resolve(process.cwd(), '..', 'Frontend', 'dist');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cookieParser());
  app.use(cors({ origin: config.env === 'production' ? false : true, credentials: true }));

  // Sessions
  app.use(session({
    secret: config.session.secret,
    name: config.session.name,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: config.session.maxAgeHours * 60 * 60 * 1000,
    },
  }));

  // Per-request: load user from session
  app.use(sessionLoader);

  // CSRF on everything except GET/HEAD/OPTIONS and explicitly-skipped routes
  app.use(csrfMiddleware);

  // Rate-limit the login endpoint
  const loginLimiter = rateLimit({
    windowMs: config.security.loginRateLimitWindowMs,
    max: config.security.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' },
  });
  app.use('/api/login', loginLimiter);
  app.use('/api/setup', loginLimiter);

  // --- Routes ---
  app.use('/api', authRouter);
  app.use('/api/branches', branchRouter);
  app.use('/api/units', unitRouter);
  app.use('/api/accounts', accountRouter);
  app.use('/api/users', userRouter);

  // Health
  app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env, ts: new Date().toISOString() }));

  // --- Static frontend (production) ---
  if (config.env === 'production') {
    app.use(express.static(frontendDist));
    // SPA fallback: non-API GET requests fall back to index.html
    app.get(/^\/(?!api).*/, (req, res, next) => {
      if (req.method === 'GET' && req.accepts('html')) {
        res.sendFile(path.join(frontendDist, 'index.html'));
        return;
      }
      next();
    });
  }

  // --- Error handlers (last) ---
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(config.port, config.host, () => {
    logger.info(`ERP backend listening on http://${config.host}:${config.port} (${config.env})`);
    if (config.env === 'production') {
      logger.info(`Frontend served from ${frontendDist}`);
    } else {
      logger.info('Frontend dev server: run "npm run dev" inside Frontend/ on http://localhost:5173');
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    server.close(async () => {
      try { await require('./db/pool').closePool(); }
      catch (err) { logger.error({ err: (err as Error).message }, 'Pool close failed'); }
      process.exit(0);
    });
    // Force close after 10s
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  logger.error({ err: (err as Error).message, stack: (err as Error).stack }, 'Fatal bootstrap failure');
  process.exit(1);
});
