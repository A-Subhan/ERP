/* ===========================================================================
 * Audit log routes — admin-only
 * ==========================================================================*/
import { Router } from 'express';
import { z } from 'zod';
import { validateQuery } from '../middleware/validate';
import { requireAuth, requireAdmin } from '../middleware/auth';
import * as auditLogService from '../services/auditLog.service';

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth, requireAdmin);

const listSchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
  screenCode: z.string().optional(),
  action: z.string().optional(),
  recordNumber: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

auditLogRouter.get('/', validateQuery(listSchema), async (req, res, next) => {
  try {
    const r = await auditLogService.listAudit({
      fromDate: (req.query.fromDate as string) ?? null,
      toDate: (req.query.toDate as string) ?? null,
      userId: req.query.userId ? Number(req.query.userId) : null,
      screenCode: (req.query.screenCode as string) ?? null,
      action: (req.query.action as string) ?? null,
      recordNumber: (req.query.recordNumber as string) ?? null,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
    });
    res.json(r);
  } catch (err) { next(err); }
});

auditLogRouter.get('/actions', async (_req, res) => {
  res.json(await auditLogService.listAuditActions());
});
