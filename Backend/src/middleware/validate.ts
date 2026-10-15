/* ===========================================================================
 * Zod validation middleware — validates req.body against a zod schema.
 * ==========================================================================*/
import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validateBody(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.errors[0];
        const msg = first
          ? `${first.path.join('.') || 'body'}: ${first.message}`
          : 'Request body is not valid.';
        res.status(400).json({ error: msg, details: err.errors });
        return;
      }
      next(err);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req.query);
      req.query = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.errors[0];
        const msg = first
          ? `${first.path.join('.') || 'query'}: ${first.message}`
          : 'Query string is not valid.';
        res.status(400).json({ error: msg });
        return;
      }
      next(err);
    }
  };
}
