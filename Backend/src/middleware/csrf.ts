/* ===========================================================================
 * CSRF middleware — double-submit cookie pattern with a per-session nonce.
 * ==========================================================================*/
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const TOKEN_HEADER = 'x-csrf-token';

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
  // Constant-time compare
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'));
}

/** Skip CSRF for GET/HEAD/OPTIONS; require it for everything else. */
function isSafeMethod(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Issue a fresh token to the response. Skip issuance if no session yet
  // (login/setup endpoints can opt out via skipCsrf below).
  const issue = () => {
    if (req.session?.id) {
      res.locals.csrfToken = makeToken(req.session.id);
      res.setHeader('X-CSRF-Token', res.locals.csrfToken);
    }
  };

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

/** Use on a route to skip CSRF (only for first-time setup before a session exists). */
export function skipCsrf(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
