/* ===========================================================================
 * CSRF middleware — double-submit cookie pattern with a per-session nonce.
 *
 * Public auth paths (declared in PUBLIC_PATHS below) are exempt from CSRF
 * verification because they are unauthenticated (no session exists yet at
 * the time they are called) and a CSRF attack on them has no destructive
 * consequence (login attempt is itself rate-limited; setup is one-shot).
 *
 * For all other mutating requests (POST/PUT/PATCH/DELETE) the client must
 * send the X-CSRF-Token header that the server issued on a prior safe GET.
 * ==========================================================================*/
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const TOKEN_HEADER = 'x-csrf-token';

// Paths (matched against req.path) that bypass CSRF verification entirely.
// These are public endpoints that may be called before a session exists.
const PUBLIC_PATHS = new Set<string>([
  '/api/setup',
  '/api/login',
  '/api/setup-status',
  '/api/check-company-id',
  '/api/health',
]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

/** Generate a fresh CSRF token bound to the session id. */
function makeToken(sessionId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const mac = crypto.createHmac('sha256', config.csrf.secret)
    .update(sessionId + ':' + nonce)
    .digest('hex');
  return nonce + '.' + mac;
}

/** Verify a presented token. */
function verifyToken(sessionId: string, token: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [nonce, mac] = token.split('.');
  if (!nonce || !mac) return false;
  const expected = crypto.createHmac('sha256', config.csrf.secret)
    .update(sessionId + ':' + nonce)
    .digest('hex');
  if (mac.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return false;
  }
}

function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  const issue = () => {
    if (req.session?.id) {
      res.locals.csrfToken = makeToken(req.session.id);
      res.setHeader('X-CSRF-Token', res.locals.csrfToken);
    }
  };

  // Public paths bypass verification entirely. We still issue a token so the
  // client has one for subsequent protected requests.
  if (isPublicPath(req.path)) {
    issue();
    next();
    return;
  }

  if (isSafeMethod(req.method)) {
    issue();
    next();
    return;
  }

  const token = req.get(TOKEN_HEADER) as string | undefined;
  if (!req.session?.id || !token) {
    res.status(403).json({ error: 'Missing security token. Refresh the page and try again.' });
    return;
  }
  if (!verifyToken(req.session.id, token)) {
    res.status(403).json({ error: 'Security token is invalid or has expired. Refresh the page and try again.' });
    return;
  }
  issue();
  next();
}

/** Kept for backward compatibility — does nothing, since the path-based
 *  PUBLIC_PATHS check above is the actual gate. */
export function skipCsrf(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
