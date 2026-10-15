/* ===========================================================================
 * Error middleware — turns thrown errors into user-facing JSON messages.
 * ==========================================================================*/
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'The page you requested does not exist.' });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    // DB constraint / business-logic rejection: surface message verbatim
    if (/constraint|violation|RaisError|RAISERROR|cannot|must|not allowed/i.test(err.message)) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Something went wrong on the server. Please try again or contact support.' });
    return;
  }
  logger.error({ err: String(err), path: req.path }, 'Unknown non-Error thrown');
  res.status(500).json({ error: 'Internal server error.' });
}
